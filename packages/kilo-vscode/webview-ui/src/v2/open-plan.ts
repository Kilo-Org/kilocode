// Opens the plan file of a completed `open_plan` call in the editor. A Code Mode call surfaces the nested
// open_plan request on its `execute` completion instead. The completion event carries the tool id and metadata but
// not the tool name, so the name is recorded from the start event.
const OPEN_TOOLS = new Set(["open_plan", "execute"])

export type PlanOpen = {
  id: string
  path: string
  sessionID: string
}

export function createPlanOpener(active: () => string | undefined, open: (plan: PlanOpen) => void) {
  const plans = new Set<string>()
  const opened = new Set<string>()
  const pending = new Map<string, PlanOpen>()
  const id = (sessionID: string, toolID: string) => `${sessionID}:${toolID}`

  const schedule = (plan: PlanOpen) => {
    const key = id(plan.sessionID, plan.id)
    pending.delete(key)
    if (opened.has(key)) return
    queueMicrotask(() => {
      if (active() !== plan.sessionID) {
        pending.set(key, plan)
        return
      }
      if (opened.has(key)) return
      opened.add(key)
      open(plan)
    })
  }

  return {
    started(sessionID: string, toolID: string, name: string) {
      if (OPEN_TOOLS.has(name)) plans.add(id(sessionID, toolID))
    },
    completed(sessionID: string, toolID: string, metadata?: Record<string, unknown>) {
      const key = id(sessionID, toolID)
      if (!plans.delete(key)) return
      if (metadata?.open !== true) return
      // `plan` is the earlier metadata key; keep reading it so a session started before the rename still opens.
      const path = metadata.path ?? metadata.plan
      if (typeof path !== "string" || !path) return
      const plan = { id: toolID, path, sessionID }
      if (opened.has(key)) return
      if (sessionID !== active()) {
        pending.set(key, plan)
        return
      }
      schedule(plan)
    },
    failed(sessionID: string, toolID: string) {
      plans.delete(id(sessionID, toolID))
    },
    /** Drops the state of a deleted session, so a long-lived webview does not keep it. */
    forget(sessionID: string) {
      const prefix = `${sessionID}:`
      for (const set of [plans, opened]) for (const key of [...set]) if (key.startsWith(prefix)) set.delete(key)
      for (const key of [...pending.keys()]) if (key.startsWith(prefix)) pending.delete(key)
    },
    /** Defer plans from inactive sessions until their session becomes active. */
    flush(sessionID: string | undefined) {
      if (!sessionID) return
      for (const plan of pending.values()) if (plan.sessionID === sessionID) schedule(plan)
    },
  }
}
