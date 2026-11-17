import { sessionDirectory } from "./worktree-file-path"
import type { WorktreeStateManager } from "./WorktreeStateManager"

/**
 * The folder a rendered image saves to: the server directory of the session that shows it, else the active review
 * directory, else the server directory of the viewed session, else the project root. The server directory is
 * authoritative because a session runs in exactly one directory and may be a subagent or belong to a project that is
 * not active.
 */
export async function resolveImageDirectory(input: {
  /** The session that asked to save the image. */
  sessionID?: string
  /** The session the panel last reported as viewed, for save requests that carry no session. */
  visibleSession?: string | null
  /** The worktree of the review or Documents pane, which render outside a transcript and carry no session. */
  activeDiffDirectory?: () => string | undefined
  state?: WorktreeStateManager
  root?: string
  /** Reads the server directory of a session. */
  location: (sessionID: string) => Promise<string | undefined>
}): Promise<string | undefined> {
  const resolve = async (id: string) => {
    const direct = await input.location(id)
    if (direct) return direct
    const filed = input.state?.getSession(id)
    if (!filed) return input.root
    return sessionDirectory(input.state, id, input.root) ?? input.root
  }

  if (input.sessionID) return resolve(input.sessionID)
  const diff = input.activeDiffDirectory?.()
  if (diff) return diff
  if (input.visibleSession) return resolve(input.visibleSession)
  return input.root
}
