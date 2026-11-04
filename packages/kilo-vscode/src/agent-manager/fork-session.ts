import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { getErrorMessage } from "./errors"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { recordForkHandoff } from "./fork-handoff"

export interface ForkContext {
  client: () => Promise<OpenCodeClient>
  state: WorktreeStateManager | undefined
  directory: string | undefined
  postError: (message: string) => void
  registerWorktreeSession: (sessionId: string, directory: string) => void
  pushState: () => void
  notifyForked: (session: SessionInfo, forkedFromId: string, worktreeId?: string) => void
  log: (...args: unknown[]) => void
}

/**
 * Fork a session through the server, register the new session in state, and
 * notify the webview.
 *
 * Pure orchestration — no vscode imports.
 */
export async function forkSession(
  ctx: ForkContext,
  sessionId: string,
  worktreeId?: string,
  messageId?: string,
): Promise<null> {
  let client: OpenCodeClient
  try {
    client = await ctx.client()
  } catch (err) {
    ctx.log("forkSession: client not available:", err)
    ctx.postError("Not connected to CLI backend")
    return null
  }

  const directory = (() => {
    if (!worktreeId || !ctx.state) return ctx.directory
    return ctx.state.getWorktree(worktreeId)?.path ?? ctx.directory
  })()

  let forked: SessionInfo
  try {
    forked = await client.session.fork(
      { sessionID: sessionId, ...(messageId ? { before: messageId } : {}) },
    )
    if (directory) await client.session.move({ sessionID: forked.id, directory })
  } catch (error) {
    ctx.postError(`Failed to fork session: ${getErrorMessage(error)}`)
    return null
  }

  if (worktreeId && ctx.state) {
    ctx.state.addSession(forked.id, worktreeId)
    if (directory) ctx.registerWorktreeSession(forked.id, directory)
  }

  await recordForkHandoff({ client, sessionId: forked.id, directory }).catch((err) => {
    ctx.log("forkSession: failed to record fork handoff:", getErrorMessage(err))
  })

  ctx.pushState()
  ctx.notifyForked(forked, sessionId, worktreeId)
  ctx.log(`Forked session ${sessionId} → ${forked.id}${worktreeId ? ` in worktree ${worktreeId}` : ""}`)
  return null
}