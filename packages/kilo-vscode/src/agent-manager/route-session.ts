import type { OpenCodeClient } from "@opencode/client"
import { pathKey } from "./project/paths"
import { moveSession } from "./session-move"
import type { WorktreeStateManager } from "./WorktreeStateManager"

/**
 * Where the server runs the session after a routing request: in the target directory now, in it later because the
 * move is queued behind a running step, or not at all because the read or move failed.
 */
export type RouteOutcome = "moved" | "queued" | "failed"

/**
 * Runs a session in `directory` on the server, and reports whether it does. Opening a worktree session locally files
 * it under Local, and v1 also ran it in the project root from then on. A v2 session runs only in its server directory,
 * so without the move it would keep working in the worktree while Local shows the root checkout's files and diff, and
 * the worktree's recovery would file it back under the worktree on the next start. A caller files the session only
 * when the move landed; a queued move is not a failure and must not keep the old filing as if it were final. Never
 * rejects.
 */
export async function routeSession(
  client: OpenCodeClient,
  sessionId: string,
  directory: string,
  log: (...args: unknown[]) => void,
): Promise<RouteOutcome> {
  const info = await client.session.get({ sessionID: sessionId }).catch((error: unknown) => {
    log(`Failed to read session ${sessionId} before moving it:`, error)
    return undefined
  })
  if (!info) return "failed"
  if (pathKey(info.location.directory) === pathKey(directory)) return "moved"
  const result = await moveSession(client, info, directory).catch((error: unknown) => {
    log(`Failed to move session ${sessionId} to ${directory}:`, error)
    return undefined
  })
  if (!result) return "failed"
  return result.landed ? "moved" : "queued"
}

/**
 * Files a session under Local, but only once it runs in the project root. A move the server accepted but has not
 * applied yet is reported as queued; the `session.moved` event then files it when the move lands, so the filing
 * follows the server instead of the request timing.
 */
export async function fileSessionLocally(input: {
  client: OpenCodeClient | undefined
  state: WorktreeStateManager | undefined
  sessionId: string
  root: string
  log: (...args: unknown[]) => void
}): Promise<RouteOutcome> {
  const outcome = input.client ? await routeSession(input.client, input.sessionId, input.root, input.log) : "failed"
  if (outcome !== "moved" || !input.state) return outcome
  const filed = input.state.getSession(input.sessionId)
  // History can open an unfiled conversation. The panel needs a filing while its Local store loads the session.
  if (!filed) input.state.addSession(input.sessionId, null)
  else if (filed.worktreeId !== null) input.state.moveSession(input.sessionId, null)
  return outcome
}
