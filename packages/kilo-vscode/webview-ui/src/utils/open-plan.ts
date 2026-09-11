import type { ExtensionMessage } from "../types/messages"

type Update =
  | Extract<ExtensionMessage, { type: "partUpdated" }>
  | Extract<ExtensionMessage, { type: "partsUpdated" }>["updates"][number]

export type PlanOpen = {
  id: string
  path: string
  sessionID: string
}

const opened = new Set<string>()
const pending = new Map<string, PlanOpen>()

function read(message: ExtensionMessage): PlanOpen[] {
  const updates: Update[] =
    message.type === "partUpdated" ? [message] : message.type === "partsUpdated" ? message.updates : []

  return updates.flatMap((update) => {
    const part = update.part
    if (part.type !== "tool" || part.tool !== "open_plan" || part.state.status !== "completed") return []
    if (part.state.metadata?.open !== true) return []
    const path = part.state.metadata.plan
    if (typeof path !== "string" || !path || !update.sessionID) return []
    return [{ id: part.id, path, sessionID: update.sessionID }]
  })
}

export function planOpens(message: ExtensionMessage, activeSessionID: string | undefined): PlanOpen[] {
  return read(message).filter((plan) => plan.sessionID === activeSessionID)
}

/** Defer plans from inactive sessions until their session becomes active. */
export function createPlanOpener(active: () => string | undefined, open: (plan: PlanOpen) => void) {
  const id = (plan: PlanOpen) => `${plan.sessionID}:${plan.id}`
  const schedule = (plan: PlanOpen) => {
    const key = id(plan)
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
  const accept = (message: ExtensionMessage) => {
    const current = active()
    for (const plan of read(message)) {
      const key = id(plan)
      if (opened.has(key)) continue
      if (plan.sessionID !== current) {
        pending.set(key, plan)
        continue
      }
      schedule(plan)
    }
  }
  const flush = (sessionID: string | undefined) => {
    if (!sessionID) return
    for (const plan of pending.values()) {
      if (plan.sessionID === sessionID) schedule(plan)
    }
  }
  return { accept, flush }
}
