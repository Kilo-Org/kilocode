import { routeSuggestionWebviewMessage } from "./handlers/suggestion"
import * as ModelState from "./model-state"
import { routeInputToolMessage } from "../services/input-tools"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import type { SuggestionContext } from "./handlers/suggestion"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { buildChatSettingsMessage } from "./chat-settings"
import { buildThroughputSettingMessage } from "./throughput-settings"
import { buildAutoApprovalReasonSettingMessage } from "./auto-approval-reason-settings"
import { handleModelUsageMessage, type ModelUsageMessage } from "./model-usage"

type Ctx = {
  question: SuggestionContext
  client: KiloClient | null
  connection: KiloConnectionService
  dir: string
  post: (msg: unknown) => void
  browserSettings: () => void
  exportTranscript: (sessionID: string) => Promise<void>
  resume: (sessionID: string, messageID: string, requestID: string) => Promise<void>
  copy: (text: string) => PromiseLike<void>
  openSessions: (ids: string[]) => void
  activity: (state: unknown) => void
  speechToTextModels: () => Promise<void>
  modelUsage: (message: ModelUsageMessage) => Promise<void>
  backgroundJobs: (sessionID: string, requestID: string) => Promise<void>
  board: (message: Record<string, unknown>) => Promise<boolean>
  cancelBackgroundJob: (jobID: string, sessionID: string, requestID: string) => Promise<void>
  promoteBackgroundJob: (jobID: string, sessionID: string) => Promise<void>
}

async function routeBackgroundMessage(
  message: { type: string; sessionID?: unknown; jobID?: unknown; requestID?: unknown },
  ctx: Ctx,
): Promise<boolean | undefined> {
  if (message.type === "requestSessionBoard" || message.type === "resetSessionBoard") return ctx.board(message)
  if (message.type === "requestBackgroundJobs") {
    if (typeof message.sessionID === "string" && typeof message.requestID === "string") {
      await ctx.backgroundJobs(message.sessionID, message.requestID)
    }
    return true
  }
  if (message.type === "cancelBackgroundJob") {
    if (
      typeof message.jobID === "string" &&
      typeof message.sessionID === "string" &&
      typeof message.requestID === "string"
    ) {
      await ctx.cancelBackgroundJob(message.jobID, message.sessionID, message.requestID)
    }
    return true
  }
  if (message.type === "promoteBackgroundJob") {
    if (typeof message.jobID === "string" && typeof message.sessionID === "string") {
      await ctx.promoteBackgroundJob(message.jobID, message.sessionID)
    }
    return true
  }
  return undefined
}

function isResume(input: { sessionID?: unknown; messageID?: unknown; requestID?: unknown }): input is {
  sessionID: string
  messageID: string
  requestID: string
} {
  return (
    typeof input.sessionID === "string" && typeof input.messageID === "string" && typeof input.requestID === "string"
  )
}

export async function routeEarlyMessage(
  message: { type: string; id?: unknown; text?: unknown; state?: unknown },
  ctx: Ctx,
): Promise<boolean> {
  if (message.type === "resumeSession") {
    const input = message as { sessionID?: unknown; messageID?: unknown; requestID?: unknown }
    if (isResume(input)) {
      await ctx.resume(input.sessionID, input.messageID, input.requestID)
    }
    return true
  }
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
  if (message.type === "recordModelUsage" || message.type === "requestModelUsage") {
    await ctx.modelUsage(message as ModelUsageMessage)
    return true
  }
  await routeSuggestionWebviewMessage(ctx.question, message)
  if (await ModelState.handleMessage(message.type, message, ctx.client, ctx.post)) return true
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
  if (message.type === "requestSpeechToTextModels") {
    await ctx.speechToTextModels()
    return true
  }
  if (message.type === "requestBrowserSettings") {
    ctx.browserSettings()
    return true
  }
  const background = await routeBackgroundMessage(message, ctx)
  return (
    background ?? (await routeInputToolMessage(message, { connection: ctx.connection, dir: ctx.dir, post: ctx.post }))
  )
}
