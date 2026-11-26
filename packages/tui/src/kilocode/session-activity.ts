import type { Plugin } from "@opencode/plugin/tui"

/**
 * What a session and its subagents are doing, shared by the Kilo reporters (terminal activity packets, Herdr agent
 * state, Keep Awake) so they cannot disagree. A pending permission takes precedence over a pending form. Parked synthetic context
 * stays pending without execution, so it does not count as work.
 */
export function sessionActivity(data: Plugin.Context["data"], sessionID: string) {
  const root = data.session.root(sessionID)
  const members = Array.from(new Set([root, ...data.session.family(root)]))
  const running = members.filter((id) => data.session.status(id) === "running")
  return {
    root,
    running,
    attention: members.some((id) => (data.session.permission.list(id)?.length ?? 0) > 0)
      ? ("permission" as const)
      : members.some((id) => (data.session.form.list(id)?.length ?? 0) > 0)
        ? ("question" as const)
        : (false as const),
    busy: members.some((id) => sessionWorking(data, id)),
  }
}

/** One session works while it runs or a queued prompt waits for it. */
export function sessionWorking(data: Plugin.Context["data"], sessionID: string) {
  return (
    data.session.status(sessionID) === "running" ||
    data.session.pending.list(sessionID).some((item) => item.type !== "synthetic")
  )
}
