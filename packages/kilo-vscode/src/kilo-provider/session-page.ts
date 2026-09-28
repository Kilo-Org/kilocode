import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import { retry } from "../services/cli-backend/retry"

export const SESSION_PAGE_LIMIT = 50

/** One page of sessions for a single directory plus the cursor for the next page. */
export interface SessionPage {
  sessions: Session[]
  cursor?: number
}

/** Per-directory paging state shared between the initial load and "load more". */
export interface SessionPageState {
  dirs: Map<string, { cursor?: number; more: boolean }>
  hasMore: boolean
}

export function createSessionPageState(): SessionPageState {
  return { dirs: new Map(), hasMore: false }
}

/**
 * Fetch one page of sessions for a directory. Uses the existing paged
 * experimental endpoint so no shared upstream session API changes are needed.
 * Older pages use the returned cursor, which is the `time_updated` of the
 * oldest session in the page.
 */
export async function fetchSessionPage(
  client: KiloClient,
  input: { dir: string; cursor?: number; limit?: number },
): Promise<SessionPage> {
  const limit = input.limit ?? SESSION_PAGE_LIMIT
  const result = await retry(() =>
    client.experimental.session.list(
      { directory: input.dir, roots: true, archived: true, limit, cursor: input.cursor },
      { throwOnError: true },
    ),
  )
  const items = result.data ?? []
  // Use the server cursor as-is. An empty or non-positive header is ignored so
  // a blank value cannot restart paging from the first page.
  const header = result.response.headers.get("x-next-cursor")?.trim()
  const parsed = header ? Number(header) : undefined
  const cursor = parsed != null && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  return { sessions: items, cursor }
}

/** Merge session batches, drop duplicate ids, and sort newest first. */
export function mergeSessions(batches: Session[][]): Session[] {
  const seen = new Set<string>()
  const merged: Session[] = []
  for (const batch of batches) {
    for (const session of batch) {
      if (seen.has(session.id)) continue
      seen.add(session.id)
      merged.push(session)
    }
  }
  return merged.sort((a, b) => b.time.updated - a.time.updated)
}
