import type { KiloConnectionService } from "./cli-backend/connection-service"
import { routeAutocompleteMessage } from "./autocomplete/settings"
import { handleSpeechToTextCancel, handleSpeechToTextStart, handleSpeechToTextStop } from "../speech-to-text/handler"
import { prewarmSpeechCapture } from "../speech-to-text/capture"

type Msg = {
  type: string
  requestId?: string
  model?: string
  language?: string
}

type Ctx = {
  connection: KiloConnectionService
  dir: string
  post: (msg: unknown) => void
}

export async function routeInputToolMessage(message: Msg, ctx: Ctx): Promise<boolean> {
  if (await routeAutocompleteMessage(message, ctx.post)) return true

  if (message.type === "speechToTextPrewarm") {
    void prewarmSpeechCapture().catch((err: unknown) => console.warn("[Kilo New] Speech capture prewarm failed:", err))
    return true
  }

  if (message.type === "speechToTextStart") {
    if (!message.requestId) return true
    handleSpeechToTextStart(
      { requestId: message.requestId, model: message.model, language: message.language },
      ctx.post,
    )
    return true
  }

  if (message.type === "speechToTextStop") {
    if (!message.requestId) return true
    handleSpeechToTextStop(ctx.connection, { requestId: message.requestId }, ctx.dir, ctx.post)
    return true
  }

  if (message.type === "speechToTextCancel") {
    if (!message.requestId) return true
    handleSpeechToTextCancel({ requestId: message.requestId }, ctx.post)
    return true
  }

  return false
}
