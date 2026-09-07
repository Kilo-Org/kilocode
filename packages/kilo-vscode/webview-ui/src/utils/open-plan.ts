import type { ExtensionMessage } from "../types/messages"

type Update =
  | Extract<ExtensionMessage, { type: "partUpdated" }>
  | Extract<ExtensionMessage, { type: "partsUpdated" }>["updates"][number]

export type PlanOpen = {
  id: string
  path: string
  sessionID: string
}

export function planOpens(message: ExtensionMessage): PlanOpen[] {
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
