import { sessionDirectory } from "./worktree-file-path"
import type { WorktreeStateManager } from "./WorktreeStateManager"

/**
 * The folder a rendered image saves to: the server directory of the session that shows it, else the filed worktree
 * of that session, else the project root. The server directory is authoritative because a session runs in exactly one
 * directory and may be a subagent or belong to a project that is not active.
 */
export async function resolveImageDirectory(input: {
  /** The session that asked to save the image. */
  sessionID?: string
  /** The session the panel last reported as viewed, for save requests that carry no session. */
  visibleSession?: string | null
  state?: WorktreeStateManager
  root?: string
  /** Reads the server directory of a session. */
  location: (sessionID: string) => Promise<string | undefined>
}): Promise<string | undefined> {
  const id = input.sessionID ?? input.visibleSession ?? undefined
  if (!id) return input.root
  const direct = await input.location(id)
  if (direct) return direct
  const filed = input.state?.getSession(id)
  if (!filed) return input.root
  return sessionDirectory(input.state, id, input.root) ?? input.root
}
