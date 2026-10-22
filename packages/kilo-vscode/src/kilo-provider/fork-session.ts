import type { Session, SessionStatus } from "@kilocode/sdk-v1/v2/client"
import type { KiloConnectionService } from "../services/cli-backend"
import { getErrorMessage } from "../kilo-provider-utils"
import { isRunningStatus } from "../session-status"

export interface ForkContext {
  connection: KiloConnectionService
  post: (message: { type: "error"; message: string }) => void
  register: (session: Session) => void
  forked: (session: Session, sourceID: string) => void
  status: (sessionID: string) => SessionStatus["type"] | undefined
  directory: (sessionID: string) => string
}

export async function handleForkSession(ctx: ForkContext, sessionId: string, messageId?: string): Promise<void> {
  const status =
    ctx.status(sessionId) ??
    (await Promise.resolve()
      .then(() =>
        ctx.connection.getClient().session.status({ directory: ctx.directory(sessionId) }, { throwOnError: true }),
      )
      .then((result) => result.data?.[sessionId]?.type ?? "idle")
      .catch((e) => {
        console.error("[Kilo New] refreshForkStatus failed:", e)
        return "busy" as SessionStatus["type"]
      }))
  if (isRunningStatus(status)) {
    ctx.post({ type: "error", message: "Wait for the session to finish before forking it." })
    return
  }

  const forked = await ctx.connection
    .getClient()
    .session.fork(
      { sessionID: sessionId, directory: ctx.directory(sessionId), ...(messageId ? { messageID: messageId } : {}) },
      { throwOnError: true },
    )
    .then((result) => result.data)
    .catch((error: unknown) => {
      ctx.post({ type: "error", message: `Failed to fork session: ${getErrorMessage(error)}` })
      return undefined
    })
  if (!forked) return
  ctx.register(forked)
  ctx.forked(forked, sessionId)
  console.log(`[Kilo New] KiloProvider: Forked session ${sessionId} to ${forked.id}`)
}
