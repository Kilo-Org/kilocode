// kilocode_change - new file
import { createSignal } from "solid-js"

const sessions = new Set<string>()
const replies = new Map<string, Set<string>>()
const [version, setVersion] = createSignal(0)

function touch() {
  setVersion((value) => value + 1)
}

export type TuiSessionRef = {
  id: string
  parentID?: string | null
}

export namespace TuiAutoApprove {
  export function track() {
    return version()
  }

  export function enabled(sessionID?: string) {
    track()
    if (!sessionID) return false
    return sessions.has(sessionID)
  }

  export function set(sessionID: string, enable: boolean) {
    if (enable) {
      sessions.add(sessionID)
      touch()
      return
    }
    clear(sessionID)
  }

  export function boot(sessionID?: string) {
    if (!sessionID) return false
    sessions.add(sessionID)
    touch()
    return true
  }

  export function shouldReply(sessionID?: string, requestID?: string) {
    if (!sessionID || !requestID) return false
    if (!sessions.has(sessionID)) return false
    return !replies.get(sessionID)?.has(requestID)
  }

  export function mark(sessionID: string, requestID: string) {
    if (!sessions.has(sessionID)) return false
    const seen = replies.get(sessionID) ?? new Set<string>()
    if (seen.has(requestID)) return false
    seen.add(requestID)
    replies.set(sessionID, seen)
    return true
  }

  export function unmark(sessionID: string, requestID: string) {
    replies.get(sessionID)?.delete(requestID)
  }

  export function clear(sessionID: string) {
    sessions.delete(sessionID)
    replies.delete(sessionID)
    touch()
  }

  export function prune(active: Set<string>) {
    for (const sessionID of sessions) {
      if (active.has(sessionID)) continue
      clear(sessionID)
    }
  }

  /**
   * Return the root session ID for a session: its own id when it has no
   * parent, otherwise the parent's id. Auto-approve is keyed by root so a
   * permission prompt in a Task/subagent child session resolves to the same
   * root as its parent.
   */
  export function root(session: TuiSessionRef | undefined) {
    return session?.parentID ?? session?.id
  }

  /**
   * Resolve a set of session IDs that are covered by enabling auto-approve
   * for \`root\`: the root itself plus any direct child sessions whose
   * \`parentID\` matches. Only direct children are included; deeper
   * subagent trees fall back to the child that spawned them.
   */
  export function scope(root: string, sessions: TuiSessionRef[]) {
    const out = new Set<string>([root])
    for (const item of sessions) {
      if (item.parentID === root) out.add(item.id)
    }
    return out
  }

  /**
   * Drop replied request IDs that no longer correspond to any pending
   * request. Called alongside \`prune\` to keep the dedupe set bounded.
   */
  export function dropStale(pending: Iterable<{ id: string }>) {
    const live = new Set<string>()
    for (const req of pending) live.add(req.id)
    for (const [sessionID, seen] of replies) {
      for (const id of seen) {
        if (!live.has(id)) seen.delete(id)
      }
      if (seen.size === 0) replies.delete(sessionID)
    }
  }

  export function roots() {
    track()
    return [...sessions]
  }
}
