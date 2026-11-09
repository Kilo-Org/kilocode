import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { getErrorMessage } from "./errors"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { recordForkHandoff } from "./fork-handoff"
import { canonicalizePath, samePath } from "./project/paths"

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

  const forked = await forkInto(client, sessionId, directory, messageId).catch((error: unknown) => {
    ctx.postError(`Failed to fork session: ${getErrorMessage(error)}`)
    return undefined
  })
  if (!forked) return null

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

/** Forks the session into the directory and returns the fork with its final location. */
async function forkInto(
  client: OpenCodeClient,
  sessionId: string,
  directory: string | undefined,
  messageId: string | undefined,
): Promise<SessionInfo> {
  const forked = await client.session
    .fork({ sessionID: sessionId, ...(messageId ? { before: messageId } : {}) })
    .catch(async (error: unknown) => {
      if (!forkEmpty(error)) throw error
      // An empty source has no boundary to copy, so its fork is a new session with the same settings.
      const source = await client.session.get({ sessionID: sessionId })
      return client.session.create({
        ...(directory ? { location: { directory } } : {}),
        ...(source.title ? { title: source.title } : {}),
        ...(source.agent ? { agent: source.agent } : {}),
        ...(source.model ? { model: source.model } : {}),
        ...(source.metadata ? { metadata: source.metadata } : {}),
      })
    })
  if (!directory || samePath(canonicalizePath(forked.location.directory), canonicalizePath(directory))) return forked
  await client.session.move({ sessionID: forked.id, directory })
  return { ...forked, location: { ...forked.location, directory } }
}

/** True when the server rejects the fork because the source has no messages. */
function forkEmpty(error: unknown): boolean {
  return typeof error === "object" && error !== null && "kind" in error && error.kind === "empty_session"
}
