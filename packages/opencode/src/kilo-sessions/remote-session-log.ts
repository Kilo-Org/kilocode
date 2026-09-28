// The two log lines `kilo remote` writes about the sessions it hosts: one when
// a session starts being hosted, one when it ends. Both go through the CLI's
// existing logger at its existing level — this module owns no file, adds no
// dependency and never touches the prompt or the credentials.
//
// The id/start-date/duration triple is kept in memory for the lifetime of the
// run (one process = one run), so the end line does not need another storage
// read to report how long the session ran.

export namespace RemoteSessionLog {
  export type Logger = {
    info: (message: string, extra?: Record<string, unknown>) => void
  }

  export type Start = {
    sessionID: string
    model?: string
    directory?: string
  }

  export type End = {
    sessionID: string
    reason: string
  }

  // sessionID -> start date (ISO 8601) of the sessions this run has started and
  // not yet ended.
  const open = new Map<string, string>()

  // `providerID/modelID`, the form the rest of the CLI prints. Structurally
  // accepts both the session row's model and the create request's model.
  export function modelLabel(model: { providerID: string; id: string } | null | undefined) {
    if (!model) return undefined
    return `${model.providerID}/${model.id}`
  }

  export function start(log: Logger, input: Start) {
    const startedAt = new Date().toISOString()
    open.set(input.sessionID, startedAt)
    log.info("remote session started", {
      sessionID: input.sessionID,
      startedAt,
      ...(input.model ? { model: input.model } : {}),
      ...(input.directory ? { directory: input.directory } : {}),
    })
  }

  export function end(log: Logger, input: End) {
    const startedAt = open.get(input.sessionID)
    // Only a session this run started can be ended: without a recorded start
    // date there is no duration to report, and a half line would be worse than
    // none. A session this run adopted (created by an earlier run) therefore
    // produces neither line here.
    if (!startedAt) return
    open.delete(input.sessionID)
    log.info("remote session ended", {
      sessionID: input.sessionID,
      startedAt,
      durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
      reason: input.reason,
    })
  }

  // Closes every session this run started and still has open, so a run that
  // ends with attached sessions (Ctrl-C on `kilo remote`) also leaves a trace.
  export function endAll(log: Logger, reason: string) {
    for (const sessionID of Array.from(open.keys())) end(log, { sessionID, reason })
  }
}
