interface ReplayGateDeps {
  /** Write one output chunk to xterm, optionally observing parser completion. */
  write(data: string | Uint8Array, callback?: () => void): void
  /** Release input buffered before the initial PTY attachment. */
  flush(): void
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function byteLength(data: string | Uint8Array) {
  return typeof data === "string" ? encoder.encode(data).byteLength : data.byteLength
}

function tail(data: string, limit: number) {
  const bytes = encoder.encode(data)
  if (bytes.byteLength <= limit) return data
  let start = bytes.byteLength - limit
  while (start < bytes.byteLength && (bytes[start]! & 0xc0) === 0x80) start++
  return decoder.decode(bytes.subarray(start))
}

/** Keep terminal protocol replies ahead of user input without reordering the
 * user's bytes when both arrive while initial replay is being parsed. */
export function createInputBuffer(limit = 256 * 1024) {
  let input = ""
  let replies = ""

  const add = (data: string, reply = false) => {
    if (reply) {
      replies += data
      replies = tail(replies, limit)
      return
    }
    input += data
    input = tail(input, limit)
  }

  const take = () => {
    const data = replies + input
    replies = ""
    input = ""
    return data
  }

  const clear = () => {
    replies = ""
    input = ""
  }

  return { add, clear, take }
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
  delay: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> = (callback, ms) =>
    setTimeout(callback, ms),
  clearDelay: (handle: ReturnType<typeof setTimeout>) => void = (handle) => clearTimeout(handle),
  maxBytes: number = 512 * 1024,
) {
  let chunks: Array<string | Uint8Array> = []
  let callbacks: Array<() => void> = []
  let pendingBytes = 0
  let scheduled = false
  let raf: number | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined

  const drain = () => {
    if (raf !== undefined) unschedule(raf)
    if (watchdog !== undefined) clearDelay(watchdog)
    raf = undefined
    watchdog = undefined
    scheduled = false
    const data = chunks
    const cbs = callbacks
    chunks = []
    callbacks = []
    pendingBytes = 0
    if (data.length === 0 && cbs.length === 0) return
    const groups: Array<string | Uint8Array> = []
    for (const chunk of data) {
      const prior = groups.at(-1)
      if (typeof chunk === "string") {
        if (typeof prior === "string") groups[groups.length - 1] = prior + chunk
        else groups.push(chunk)
        continue
      }
      if (!(prior instanceof Uint8Array)) {
        groups.push(chunk)
        continue
      }
      const merged = new Uint8Array(prior.byteLength + chunk.byteLength)
      merged.set(prior)
      merged.set(chunk, prior.byteLength)
      groups[groups.length - 1] = merged
    }
    if (groups.length === 0) groups.push("")
    const complete = () => {
      for (const cb of cbs) cb()
    }
    for (let index = 0; index < groups.length; index++) {
      write(groups[index]!, index === groups.length - 1 ? complete : undefined)
    }
  }

  const kick = () => {
    if (scheduled) return
    scheduled = true
    raf = schedule(drain)
    watchdog = delay(drain, 250)
  }

  const writeChunk = (data: string | Uint8Array, callback?: () => void) => {
    if ((typeof data === "string" ? data.length : data.byteLength) === 0 && !callback) return
    const bytes = byteLength(data)
    if (pendingBytes > 0 && pendingBytes + bytes > maxBytes) drain()
    chunks.push(data)
    pendingBytes += bytes
    if (callback) callbacks.push(callback)
    if (pendingBytes >= maxBytes) {
      drain()
      return
    }
    kick()
  }

  const cancel = () => {
    if (raf !== undefined) unschedule(raf)
    if (watchdog !== undefined) clearDelay(watchdog)
    raf = undefined
    watchdog = undefined
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
  let pending: Array<{ data: string | Uint8Array; callback?: () => void }> = []
  let bytes = 0
  // The server retains at most 2 Mi UTF-16 code units. Eight MiB covers
  // their maximum UTF-8 expansion while still staying far below xterm's
  // 50 MiB discard watermark if a boundary frame never arrives.
  const limit = 8 * 1024 * 1024

  const attach = (reconnecting: boolean) => {
    serial++
    blocked = !reconnecting
    boundary = false
    draining = false
    pending = []
    bytes = 0
  }

  const output = (data: string | Uint8Array, callback?: () => void) => {
    if (blocked && !boundary) {
      bytes += byteLength(data)
      if (bytes > limit) {
        serial++
        blocked = false
        pending = []
        bytes = 0
        return false
      }
      pending.push({ data, callback })
      return true
    }
    deps.write(data, callback)
    return true
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
      for (const chunk of pending) deps.write(chunk.data, chunk.callback)
      pending = []
      bytes = 0
      deps.write("", () => {
        if (serial !== current) return
        draining = false
        blocked = false
        deps.flush()
      })
    }
    return true
  }

  const cancel = () => {
    serial++
    blocked = false
    boundary = false
    draining = false
    pending = []
    bytes = 0
  }

  return { attach, blocked: () => blocked, cancel, draining: () => draining, frame, output }
}
