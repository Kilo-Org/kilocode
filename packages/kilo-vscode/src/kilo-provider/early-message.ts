import { buildChatSettingsMessage } from "./chat-settings"
import { buildThroughputSettingMessage } from "./throughput-settings"
import { buildAutoApprovalReasonSettingMessage } from "./auto-approval-reason-settings"

type Ctx = {
  post: (msg: unknown) => void
  exportTranscript: (sessionID: string) => Promise<void>
  copy: (text: string) => PromiseLike<void>
  openSessions: (ids: string[]) => void
  activity: (state: unknown) => void
}

export async function routeEarlyMessage(
  message: { type: string; id?: unknown; text?: unknown; state?: unknown },
  ctx: Ctx,
): Promise<boolean> {
  if (message.type === "copyToClipboard") {
    if (typeof message.id !== "string") return true
    if (typeof message.text !== "string") {
      ctx.post({ type: "clipboardWriteResult", id: message.id, ok: false, error: "Invalid clipboard text" })
      return true
    }
    await ctx.copy(message.text).then(
      () => ctx.post({ type: "clipboardWriteResult", id: message.id, ok: true }),
      (err) =>
        ctx.post({
          type: "clipboardWriteResult",
          id: message.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
    )
    return true
  }
  if (message.type === "exportSessionTranscript") {
    const input = message as { sessionID?: unknown }
    if (typeof input.sessionID === "string") await ctx.exportTranscript(input.sessionID)
    return true
  }
  if (message.type === "sessionActivity") {
    ctx.activity(message.state)
    return true
  }
  if (message.type === "sidebar.openSessions") {
    const input = message as { sessionIDs?: unknown }
    const ids = Array.isArray(input.sessionIDs)
      ? input.sessionIDs.filter((id): id is string => typeof id === "string")
      : []
    ctx.openSessions(ids)
    return true
  }
  if (message.type === "requestChatSettings") {
    ctx.post(buildChatSettingsMessage())
    return true
  }
  if (message.type === "requestThroughputSetting") {
    ctx.post(buildThroughputSettingMessage())
    return true
  }
  if (message.type === "requestAutoApprovalReasonSetting") {
    ctx.post(buildAutoApprovalReasonSettingMessage())
    return true
  }
  return false
}
