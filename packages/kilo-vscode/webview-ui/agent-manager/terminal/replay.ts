interface ReplayGateDeps {
  /** Write one output chunk to xterm, optionally observing parser completion. */
  write(data: string | Uint8Array, callback?: () => void): void
  /** Release input buffered before the initial PTY attachment. */
  flush(): void
}

/** Keep terminal protocol replies ahead of user input without reordering the
 * user's bytes when both arrive while initial replay is being parsed. */
export function createInputBuffer(limit = 256 * 1024) {
  let input = ""
  let replies = ""

  const add = (data: string, reply = false) => {
    if (reply) {
      replies += data
      if (replies.length > limit) replies = replies.slice(-limit)
      return
    }
    input += data
    if (input.length > limit) input = input.slice(-limit)
  }

  const take = () => {
    const data = replies + input
    replies = ""
    input = ""
    return data
  }

  return { add, take }
}

/**
 * Coalesce per-message PTY chunks into one xterm write per animation
 * frame. xterm parses every `write()` call with its own scope and
 * schedules a render cycle per dirty buffer; at sustained streaming
 * rates (one WebSocket message per line of output) that multiplies
 * parse runs and render schedules. One write per frame keeps the parser
 * busy once instead of once per message; output latency stays under one
 * frame. Callbacks attached to individual chunks fire after the batch
 * that contained them finishes parsing, preserving replay-gate ordering.
 *
 * Two safety valves keep the batch bounded: a watchdog flushes via a
 * timer when animation frames stop (background or minimized windows
 * throttle rAF), and a byte cap flushes immediately so a burst never
 * accumulates anywhere near xterm's discard watermark.
 */
export function createWriteBatcher(
  write: (data: string | Uint8Array, callback?: () => void) => void,
  schedule: (callback: () => void) => number = (callback) => requestAnimationFrame(callback),
  unschedule: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
  delay: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> = (callback, ms) => setTimeout(callback, ms),
  clearDelay: (handle: ReturnType<typeof setTimeout>) => void = (handle) => clearTimeout(handle),
  maxBytes: number = 512 * 1024,
) {
  let chunks: Array<string | Uint8Array> = []
  let callbacks: Array<() => void> = []
  let pendingBytes = 0
  let scheduled = false
  let raf = 0
  let watchdog: ReturnType<typeof setTimeout> | 0 = 0

  const drain = () => {
    if (raf !== 0) unschedule(raf)
    if (watchdog !== 0) clearDelay(watchdog)
    raf = 0
    watchdog = 0
    scheduled = false
    const data = chunks
    const cbs = callbacks
    chunks = []
    callbacks = []
    pendingBytes = 0
    let joined: string | Uint8Array = ""
    if (data.length === 1) {
      joined = data[0]!
    } else {
      let text = true
      for (const chunk of data) {
        if (typeof chunk !== "string") {
          text = false
          break
        }
      }
      if (text) {
        joined = data.join("")
      } else {
        const encoder = new TextEncoder()
        const parts = data.map((chunk) => (typeof chunk === "string" ? encoder.encode(chunk) : chunk))
        const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
        const merged = new Uint8Array(length)
        let offset = 0
        for (const part of parts) {
          merged.set(part, offset)
          offset += part.byteLength
        }
        joined = merged
      }
    }
    write(joined, () => {
      for (const cb of cbs) cb()
    })
  }

  const kick = () => {
    if (scheduled) return
    scheduled = true
    raf = schedule(drain)
    watchdog = delay(drain, 250)
  }

  const writeChunk = (data: string | Uint8Array, callback?: () => void) => {
    chunks.push(data)
    pendingBytes += typeof data === "string" ? data.length : data.byteLength
    if (callback) callbacks.push(callback)
    if (pendingBytes >= maxBytes) {
      drain()
      return
    }
    kick()
  }

  const cancel = () => {
    if (raf !== 0) unschedule(raf)
    if (watchdog !== 0) clearDelay(watchdog)
    raf = 0
    watchdog = 0
    scheduled = false
    chunks = []
    callbacks = []
    pendingBytes = 0
  }

  return { write: writeChunk, cancel }
}

/**
 * Gate initial user input on the PTY replay boundary. The backend sends a
 * binary 0x00 metadata frame after retained output; waiting for xterm to parse
 * everything queued before that frame keeps shell capability replies ahead of
 * the command the user typed while the PTY was starting.
 *
 * Reconnects keep their existing output-settle timer instead. Their buffered
 * input belongs to an exited shell recovery flow, not the initial attachment.
 */
export function createReplayGate(deps: ReplayGateDeps) {
  let blocked = false
  let boundary = false
  let draining = false
  let serial = 0
  let pending: Array<string | Uint8Array> = []

  const attach = (reconnecting: boolean) => {
    serial++
    blocked = !reconnecting
    boundary = false
    draining = false
    pending = []
  }

  const output = (data: string | Uint8Array) => {
    if (blocked && !boundary) {
      pending.push(data)
      return
    }
    deps.write(data)
  }

  const frame = (data: Uint8Array) => {
    if (data.length === 0 || data[0] !== 0x00) return false
    if (blocked && !boundary) {
      boundary = true
      // Match OpenCode's transport ordering: once the server says replay is
      // complete, xterm-generated replies from parsing those queued chunks
      // must precede the command typed while the PTY was starting. Keep user
      // input blocked until the parser-drain callback below; TerminalTab puts
      // parser-generated replies in its separate priority buffer meanwhile.
      draining = true
      const current = serial
      for (const chunk of pending) deps.write(chunk)
      pending = []
      deps.write("", () => {
        if (serial !== current) return
        draining = false
        blocked = false
        deps.flush()
      })
    }
    return true
  }

  return { attach, blocked: () => blocked, draining: () => draining, frame, output }
}
