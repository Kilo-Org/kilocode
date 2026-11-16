import type { OpenCodeClient } from "@opencode/client"
import { pathKey } from "./project/paths"
import { moveSession } from "./session-move"
import type { WorktreeStateManager } from "./WorktreeStateManager"

/**
 * Runs a session in `directory` on the server, and reports whether it does. Opening a worktree session locally files
 * it under Local, and v1 also ran it in the project root from then on. A v2 session runs only in its server
 * directory, so without the move it would keep working in the worktree while Local shows the root checkout's files
 * and diff, and the worktree's recovery would file it back under the worktree on the next start. A caller files the
 * session only when this returns true, so a failed move never claims a session Local does not run. Never rejects.
 */
export async function routeSession(
  client: OpenCodeClient,
  sessionId: string,
  directory: string,
  log: (...args: unknown[]) => void,
): Promise<boolean> {
  const info = await client.session.get({ sessionID: sessionId }).catch((error: unknown) => {
    log(`Failed to read session ${sessionId} before moving it:`, error)
    return undefined
  })
  if (!info) return false
  if (pathKey(info.location.directory) === pathKey(directory)) return true
  return moveSession(client, info, directory).then(
    (moved) => pathKey(moved.location.directory) === pathKey(directory),
    (error: unknown) => {
      log(`Failed to move session ${sessionId} to ${directory}:`, error)
      return false
    },
  )
}

/**
 * Files a session under Local, but only once it runs in the project root. Returns false, and leaves the filing as it
 * is, when the server could not move it, so the panel never shows a session whose store Local does not read.
 */
export async function fileSessionLocally(input: {
  client: OpenCodeClient | undefined
  state: WorktreeStateManager | undefined
  sessionId: string
  root: string
  log: (...args: unknown[]) => void
}): Promise<boolean> {
  const moved = input.client ? await routeSession(input.client, input.sessionId, input.root, input.log) : false
  if (!moved) return false
  if (input.state?.getSession(input.sessionId)) input.state.moveSession(input.sessionId, null)
  return true
}
