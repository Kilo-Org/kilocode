import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import { getErrorMessage } from "../kilo-provider-utils"
import { TelemetryProxy, TelemetryEventName } from "../services/telemetry"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { PLATFORM } from "./constants"

export interface ForkContext {
  getClient: () => KiloClient
  state: WorktreeStateManager | undefined
  postError: (message: string) => void
  registerWorktreeSession: (sessionId: string, directory: string) => void
  pushState: () => void
  notifyForked: (session: Session, forkedFromId: string, worktreeId?: string) => void
  registerSession: (session: Session) => void
  log: (...args: unknown[]) => void
}

/**
 * Fork a session via the CLI backend, register the new session in state,
 * and notify the webview.
 *
 * Pure orchestration — no vscode imports.
 */
export async function forkSession(
  ctx: ForkContext,
  sessionId: string,
  worktreeId?: string,
  messageId?: string,
): Promise<null> {
  let client: KiloClient
  try {
    client = ctx.getClient()
  } catch (err) {
    ctx.log("forkSession: client not available:", err)
    ctx.postError("Not connected to CLI backend")
    return null
  }

  const directory = (() => {
    if (!worktreeId || !ctx.state) return undefined
    return ctx.state.getWorktree(worktreeId)?.path
  })()

  let forked: Session
  try {
    const input = { sessionID: sessionId, directory, ...(messageId ? { messageID: messageId } : {}) }
    const { data } = await client.session.fork(input, { throwOnError: true })
    forked = data
  } catch (error) {
    const err = getErrorMessage(error)
    ctx.postError(`Failed to fork session: ${err}`)
    TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_SESSION_ERROR, {
      source: PLATFORM,
      error: err,
      context: "forkSession",
      sessionId,
    })
    return null
  }

  if (worktreeId && ctx.state) {
    ctx.state.addSession(forked.id, worktreeId)
    if (directory) ctx.registerWorktreeSession(forked.id, directory)
  }

  ctx.pushState()
  ctx.notifyForked(forked, sessionId, worktreeId)
  ctx.registerSession(forked)
  ctx.log(`Forked session ${sessionId} → ${forked.id}${worktreeId ? ` in worktree ${worktreeId}` : ""}`)
  return null
}
