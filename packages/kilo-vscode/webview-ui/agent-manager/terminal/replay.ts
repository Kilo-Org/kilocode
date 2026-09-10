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
