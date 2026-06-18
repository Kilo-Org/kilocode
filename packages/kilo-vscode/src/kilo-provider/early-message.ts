import { routeSuggestionWebviewMessage } from "./handlers/suggestion"
import * as ModelState from "./model-state"
import { routeInputToolMessage } from "../services/input-tools"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import type { SuggestionContext } from "./handlers/suggestion"
import type { KiloClient } from "@kilocode/sdk/v2/client"

type Ctx = {
  question: SuggestionContext
  client: KiloClient | null
  connection: KiloConnectionService
  dir: string
  post: (msg: unknown) => void
  exportTranscript: (sessionID: string) => Promise<void>
}

export async function routeEarlyMessage(message: { type: string }, ctx: Ctx): Promise<boolean> {
  await routeSuggestionWebviewMessage(ctx.question, message)
  if (await ModelState.handleMessage(message.type, message, ctx.client, ctx.post)) return true
  if (message.type === "exportSessionTranscript") {
    const input = message as { sessionID?: unknown }
    if (typeof input.sessionID === "string") await ctx.exportTranscript(input.sessionID)
    return true
  }
  return await routeInputToolMessage(message, { connection: ctx.connection, dir: ctx.dir, post: ctx.post })
}
