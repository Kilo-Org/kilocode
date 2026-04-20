import type { Session, SessionStatus } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../services/cli-backend"
import { forkSession } from "../agent-manager/fork-session"

export interface ForkContext {
  connection: KiloConnectionService
  post: (message: { type: "error"; message: string }) => void
  register: (session: Session) => void
  forked: (session: Session) => void
  status: (sessionID: string) => SessionStatus["type"] | undefined
}

export async function handleForkSession(ctx: ForkContext, sessionId: string, messageId?: string): Promise<void> {
  const status = ctx.status(sessionId)
  if (status && status !== "idle") {
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
