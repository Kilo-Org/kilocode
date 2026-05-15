import type { KiloConnectionService } from "./cli-backend/connection-service"
import { routeAutocompleteMessage } from "./autocomplete/settings"
import { buildSpeechToTextSettingsMessage } from "../speech-to-text/settings"
import { handleSpeechToTextCancel, handleSpeechToTextStart, handleSpeechToTextStop } from "../speech-to-text/handler"

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

  if (message.type === "requestSpeechToTextSettings") {
    ctx.post(buildSpeechToTextSettingsMessage())
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
