import { createSignal } from "solid-js"
import type { ExtensionMessage } from "../types/messages"

const [wakeups, setWakeups] = createSignal<Record<string, number>>({})

export { wakeups }

function remove(map: Record<string, number>, sessionID: string) {
  if (map[sessionID] === undefined) return map
  const next = { ...map }
  delete next[sessionID]
  return next
}

export function handleWakeupMessage(message: ExtensionMessage): boolean {
  if (message.type === "sessionDeleted") {
    setWakeups((prev) => remove(prev, message.sessionID))
    return false
  }
  if (message.type !== "sessionWakeup") return false
  setWakeups((prev) => {
    if (message.pending <= 0) return remove(prev, message.sessionID)
    if (prev[message.sessionID] === message.pending) return prev
    return { ...prev, [message.sessionID]: message.pending }
  })
  return true
}
