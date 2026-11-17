// File links from sessions the state file does not file: subagents, which pruneSubagents keeps out of it by design,
// and sessions created outside the panel. The state file names a root only for a worktree id, `local`, or a filed
// session, so these links resolve against the directory the server runs the session in instead.
import { isAbsolutePath } from "../path-utils"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { resolveWorktreeFile, resolveWorktreeRoot } from "./worktree-file-path"

interface SessionEvent {
  type: string
  data?: unknown
  location?: { directory?: string }
}

export interface SessionFileLookup {
  state: WorktreeStateManager | undefined
  roots: SessionRoots
  /** A worktree id, `local`, or a session id. */
  id: string
  root: string | undefined
}

const LIMIT = 500

/**
 * The server directory of each session, read once and kept until the session moves or is deleted. A subagent runs in
 * its parent's directory, so the parent's root is readable for it even though the state file never holds it.
 */
export function createSessionRoots(read: (sessionID: string) => Promise<string | undefined>) {
  const roots = new Map<string, string>()
  const pending = new Map<string, Promise<string | undefined>>()

  const remember = (sessionID: string, directory: string | undefined) => {
    if (!directory) return
    if (!roots.has(sessionID) && roots.size >= LIMIT) {
      const oldest = roots.keys().next().value
      if (oldest !== undefined) roots.delete(oldest)
    }
    roots.set(sessionID, directory)
  }

  const forget = (sessionID: string) => {
    roots.delete(sessionID)
    pending.delete(sessionID)
  }

  const get = (sessionID: string): Promise<string | undefined> => {
    const known = roots.get(sessionID)
    if (known) return Promise.resolve(known)
    const running = pending.get(sessionID)
    if (running) return running
    // An unknown session is not cached, so a later link asks again after the server learns it.
    let request: Promise<string | undefined>
    request = read(sessionID).then(
      (directory) => {
        // A create, move, or delete that landed while this read ran owns the newer value. The read also clears only
        // its own pending entry, so an older read cannot abandon a newer one.
        if (pending.get(sessionID) !== request) return roots.get(sessionID)
        pending.delete(sessionID)
        remember(sessionID, directory)
        return directory
      },
      () => {
        if (pending.get(sessionID) === request) pending.delete(sessionID)
        return undefined
      },
    )
    pending.set(sessionID, request)
    return request
  }

  /** Remembers a created session's directory, follows a move, and forgets a deleted one. */
  const event = (value: SessionEvent) => {
    const sessionID = eventSessionID(value.data)
    if (!sessionID) return
    if (value.type === "session.deleted") return forget(sessionID)
    if (value.type === "session.moved") {
      const directory = eventDirectory(value.data)
      if (!directory) return
      pending.delete(sessionID)
      return remember(sessionID, directory)
    }
    if (value.type === "session.created") {
      // Session events can arrive without an envelope location, so read the payload the event carries.
      const directory = eventDirectory(value.data) ?? value.location?.directory
      if (!directory) return
      pending.delete(sessionID)
      remember(sessionID, directory)
    }
  }

  return { get, remember, forget, event }
}

export type SessionRoots = ReturnType<typeof createSessionRoots>

function eventSessionID(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const id = (data as Record<string, unknown>).sessionID
  return typeof id === "string" ? id : undefined
}

/** The directory a session event carries in `data.location.directory`; the envelope location is optional. */
function eventDirectory(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const location = (data as Record<string, unknown>).location
  if (typeof location !== "object" || location === null) return undefined
  const directory = (location as Record<string, unknown>).directory
  return typeof directory === "string" && directory.length > 0 ? directory : undefined
}

/**
 * Whether the state file already names the root of this id. Only a session it does not file needs the server read.
 */
function filed(state: WorktreeStateManager | undefined, id: string): boolean {
  return id === "local" || !!(state?.getWorktree(id) ?? state?.getSession(id))
}

/** The root a session's files resolve against, from the state file or the server directory. */
export async function resolveSessionRoot(input: SessionFileLookup): Promise<string | undefined> {
  const directory = filed(input.state, input.id) ? undefined : await input.roots.get(input.id)
  return resolveWorktreeRoot(input.state, input.id, input.root, directory)
}

/** Resolve one file reference of a session, keeping the directory-boundary check of the resolved root. */
export async function resolveSessionFile(input: SessionFileLookup & { file: string }): Promise<string | undefined> {
  if (isAbsolutePath(input.file)) return input.file
  const directory = filed(input.state, input.id) ? undefined : await input.roots.get(input.id)
  return resolveWorktreeFile(input.state, input.id, input.file, input.root, directory)
}
