import type { HostedChatModel } from "../hosted-chat-model"
import type { Activity } from "../v2/activity"

export function preparing(chat: HostedChatModel) {
  const progress = chat.snapshot()?.progress
  if (chat.snapshot()?.connection === "disconnected" || chat.snapshot()?.connection === "sleeping") return false
  if (progress?.phase === "error" || progress?.preparation === "failed") return false
  return (
    chat.phase() === "registering" ||
    chat.snapshot()?.connection === "preparing" ||
    progress?.preparation === "running" ||
    progress?.sandbox === "starting" ||
    progress?.phase === "preparing"
  )
}

/** Transport loss is not a completed or stopped agent. Never imply a restart or replay on reconnect. */
export function cloudNotice(chat: HostedChatModel) {
  const snapshot = chat.snapshot()
  if (["failed", "opening"].includes(chat.phase()) || chat.failure()) return
  if (chat.phase() === "reconnecting" || snapshot?.connection === "disconnected")
    return "agentManager.cloud.disconnected"
  if (!snapshot) return
  const progress = snapshot.progress
  if (progress?.phase === "error" || progress?.preparation === "failed") return "agentManager.setup.failed"
  if (snapshot.connection === "sleeping") return "agentManager.cloud.sleeping"
  if (progress?.phase === "finalizing") return "agentManager.cloud.stopping"
  switch (progress?.sandbox) {
    case "sleeping":
      if (snapshot.connection !== "live") return "agentManager.cloud.sleeping"
      break
    case "stopping":
      return "agentManager.cloud.stopping"
    case "unreachable":
    case "error":
      return "agentManager.cloud.disconnected"
  }
}

/** Read the live lease even when its transcript is no longer mounted. */
export function hostedActivity(chat: HostedChatModel): Activity {
  const snapshot = chat.snapshot()
  if (
    chat.phase() === "failed" ||
    snapshot?.error ||
    chat.failure() ||
    snapshot?.progress?.phase === "error" ||
    snapshot?.progress?.preparation === "failed"
  )
    return "error"
  if (chat.questions().length || chat.permissions().length) return "waiting"
  if (chat.phase() === "reconnecting" || snapshot?.status === "retry") return "retry"
  if (chat.phase() === "opening" || chat.busy() || chat.pending() || preparing(chat)) return "busy"
  return "idle"
}
