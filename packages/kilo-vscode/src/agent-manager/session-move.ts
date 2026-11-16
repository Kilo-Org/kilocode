import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { canonicalizePath, samePath } from "./project/paths"

const FIRST_DELAY_MS = 50
const MAX_DELAY_MS = 500
const LIMIT_MS = 10_000

/**
 * Moves a session and resolves once the server applied the move and the drain it woke has settled. The move is a
 * queued control item, so a note admitted while that drain still runs is promoted with it and starts a reply nobody
 * asked for. A failed read or a move that does not settle in time does not fail the call: it reports the last record
 * it saw, so the session still reaches the panel.
 */
export async function moveSession(
  client: OpenCodeClient,
  session: SessionInfo,
  directory: string,
  limitMs = LIMIT_MS,
): Promise<SessionInfo> {
  await client.session.move({ sessionID: session.id, directory })
  return (await settleMove(client, session, directory, limitMs)).session
}

/**
 * Waits for a move that was already queued and reports whether it settled: the server runs the session in
 * `directory` and no drain is active. A caller that admits input after the move needs this, since an unsettled record
 * can already name the new directory while a drain still runs.
 */
export function settleMove(
  client: OpenCodeClient,
  session: SessionInfo,
  directory: string,
  limitMs = LIMIT_MS,
): Promise<{ session: SessionInfo; settled: boolean }> {
  return settle(client, session, canonicalizePath(directory), Date.now() + limitMs, FIRST_DELAY_MS)
}

async function settle(
  client: OpenCodeClient,
  latest: SessionInfo,
  target: string,
  deadline: number,
  delay: number,
): Promise<{ session: SessionInfo; settled: boolean }> {
  const state = await Promise.all([client.session.get({ sessionID: latest.id }), client.session.active()])
    .then(([session, active]) => ({ session, active }))
    .catch(() => undefined)
  const moved = state && samePath(canonicalizePath(state.session.location.directory), target)
  if (moved && !(latest.id in state.active)) return { session: state.session, settled: true }
  if (Date.now() >= deadline) return { session: state?.session ?? latest, settled: false }
  await new Promise((resolve) => setTimeout(resolve, Math.min(delay, Math.max(deadline - Date.now(), 0))))
  return settle(client, state?.session ?? latest, target, deadline, Math.min(delay * 2, MAX_DELAY_MS))
}
