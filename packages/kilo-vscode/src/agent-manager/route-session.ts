import type { OpenCodeClient } from "@opencode/client"
import { pathKey } from "./project/paths"
import { moveSession } from "./session-move"

/**
 * Runs a session in `directory` on the server. Opening a worktree session locally files it under Local, and v1 also
 * ran it in the project root from then on. A v2 session runs only in its server directory, so without the move it
 * would keep working in the worktree while Local shows the root checkout's files and diff, and the worktree's
 * recovery would file it back under the worktree on the next start. Never rejects.
 */
export async function routeSession(
  client: OpenCodeClient,
  sessionId: string,
  directory: string,
  log: (...args: unknown[]) => void,
): Promise<void> {
  const info = await client.session.get({ sessionID: sessionId }).catch((error: unknown) => {
    log(`Failed to read session ${sessionId} before moving it:`, error)
    return undefined
  })
  if (!info) return
  if (pathKey(info.location.directory) === pathKey(directory)) return
  await moveSession(client, info, directory).catch((error: unknown) =>
    log(`Failed to move session ${sessionId} to ${directory}:`, error),
  )
}
