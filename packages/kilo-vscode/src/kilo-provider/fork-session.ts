import type { Session, SessionStatus } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../services/cli-backend"
import { forkSession } from "../agent-manager/fork-session"

export interface ForkContext {
  connection: KiloConnectionService
  post: (message: { type: "error"; message: string }) => void
  register: (session: Session) => void
  forked: (session: Session) => void
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
  if (status !== "idle") {
    ctx.post({ type: "error", message: "Wait for the session to finish before forking it." })
    return
  }

  await forkSession(
    {
      getClient: () => ctx.connection.getClient(),
      state: undefined,
      postError: (message) => ctx.post({ type: "error", message }),
      registerWorktreeSession: () => {},
      pushState: () => {},
      notifyForked: (session) => {
        ctx.register(session)
        ctx.forked(session)
      },
      registerSession: () => {},
      log: (...args) => console.log("[Kilo New] KiloProvider:", ...args),
    },
    sessionId,
    undefined,
    messageId,
  )
}
