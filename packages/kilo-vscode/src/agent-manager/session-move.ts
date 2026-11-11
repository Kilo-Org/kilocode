import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { canonicalizePath, samePath } from "./project/paths"

const POLL_MS = 50
const LIMIT_MS = 10_000

/**
 * Moves a session and resolves once the server applied the move and the drain it woke has settled. The move is a
 * queued control item, so a note admitted while that drain still runs is promoted with it and starts a reply nobody
 * asked for. Returns the session with its new location; after the time limit it returns the latest record.
 */
export async function moveSession(client: OpenCodeClient, sessionID: string, directory: string): Promise<SessionInfo> {
  await client.session.move({ sessionID, directory })
  return settle(client, sessionID, canonicalizePath(directory), Date.now() + LIMIT_MS)
}

async function settle(
  client: OpenCodeClient,
  sessionID: string,
  directory: string,
  deadline: number,
): Promise<SessionInfo> {
  const [session, active] = await Promise.all([client.session.get({ sessionID }), client.session.active()])
  const moved = samePath(canonicalizePath(session.location.directory), directory)
  if ((moved && !(sessionID in active)) || Date.now() >= deadline) return session
  await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  return settle(client, sessionID, directory, deadline)
}
