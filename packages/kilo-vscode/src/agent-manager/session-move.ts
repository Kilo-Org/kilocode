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
  return settle(client, session, canonicalizePath(directory), Date.now() + limitMs, FIRST_DELAY_MS)
}

async function settle(
  client: OpenCodeClient,
  latest: SessionInfo,
  target: string,
  deadline: number,
  delay: number,
): Promise<SessionInfo> {
  const state = await Promise.all([client.session.get({ sessionID: latest.id }), client.session.active()])
    .then(([session, active]) => ({ session, active }))
    .catch(() => undefined)
  const settled = state && samePath(canonicalizePath(state.session.location.directory), target)
  if (settled && !(latest.id in state.active)) return state.session
  if (Date.now() >= deadline) return state?.session ?? latest
  await new Promise((resolve) => setTimeout(resolve, Math.min(delay, Math.max(deadline - Date.now(), 0))))
  return settle(client, state?.session ?? latest, target, deadline, Math.min(delay * 2, MAX_DELAY_MS))
}
