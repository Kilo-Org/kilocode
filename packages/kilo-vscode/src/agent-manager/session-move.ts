import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { canonicalizePath, samePath } from "./project/paths"
import type { WorktreeStateManager } from "./WorktreeStateManager"

const FIRST_DELAY_MS = 50
const MAX_DELAY_MS = 500
const LIMIT_MS = 10_000

export interface MoveResult {
  session: SessionInfo
  /** The server already runs the session in the target directory, so the filing can follow it. */
  landed: boolean
  /** The move landed and no drain is active, so newly admitted input does not join a running reply. */
  settled: boolean
}

/**
 * Moves a session and resolves once the server applied the move and the drain it woke has settled. The move is a
 * queued control item, so a note admitted while that drain still runs is promoted with it and starts a reply nobody
 * asked for. A failed read or a move that does not land in time does not fail the call: it reports the last record
 * it saw, so the caller can still decide whether and when to file the session.
 */
export async function moveSession(
  client: OpenCodeClient,
  session: SessionInfo,
  directory: string,
  limitMs = LIMIT_MS,
): Promise<MoveResult> {
  await client.session.move({ sessionID: session.id, directory })
  return settleMove(client, session, directory, limitMs)
}

/**
 * Waits for a move that was already queued and reports whether the server runs the session in `directory` and whether
 * the drain it woke has ended. A caller that admits input after the move needs the settled flag, since an unsettled
 * record can already name the new directory while a drain still runs. Filing only needs `landed`.
 */
export function settleMove(
  client: OpenCodeClient,
  session: SessionInfo,
  directory: string,
  limitMs = LIMIT_MS,
): Promise<MoveResult> {
  return settle(client, session, canonicalizePath(directory), Date.now() + limitMs, FIRST_DELAY_MS)
}

async function settle(
  client: OpenCodeClient,
  latest: SessionInfo,
  target: string,
  deadline: number,
  delay: number,
): Promise<MoveResult> {
  const state = await Promise.all([client.session.get({ sessionID: latest.id }), client.session.active()])
    .then(([session, active]) => ({ session, active }))
    .catch(() => undefined)
  const landed = !!state && samePath(canonicalizePath(state.session.location.directory), target)
  if (landed && !(latest.id in state.active)) return { session: state.session, landed: true, settled: true }
  if (Date.now() >= deadline) return { session: state?.session ?? latest, landed, settled: false }
  await new Promise((resolve) => setTimeout(resolve, Math.min(delay, Math.max(deadline - Date.now(), 0))))
  return settle(client, state?.session ?? latest, target, deadline, Math.min(delay * 2, MAX_DELAY_MS))
}

/**
 * Files a session under the directory the server now runs it in, after a move the runner applied at a step boundary.
 * A session filed under a worktree it no longer runs in is invisible in that worktree's view and in Local, so the
 * `session.moved` event repairs the filing instead of waiting for a catalog listing. Reports whether it changed.
 */
export function fileMovedSession(
  state: WorktreeStateManager,
  sessionID: string,
  directory: string,
  root: string,
): boolean {
  const session = state.getSession(sessionID)
  if (!session) return false
  const worktree = state.findWorktreeByPath(directory)
  const target = worktree ? worktree.id : samePath(canonicalizePath(directory), canonicalizePath(root)) ? null : undefined
  if (target === undefined || session.worktreeId === target) return false
  state.moveSession(sessionID, target)
  return true
}
