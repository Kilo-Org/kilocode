import type { KiloClient } from "@kilocode/sdk/v2/client"
import { retry } from "../services/cli-backend/retry"

export const MESSAGE_PAGE_LIMIT = 80

// Bound assistant-boundary backfill so corrupt histories cannot load an entire session.
const FILL_LIMIT = 2

/**
 * Build the same base64url-encoded cursor format the server emits so a
 * synthesized cursor round-trips through `session.messages({ before })`.
 * Server contract: `{ id, time }` JSON → base64url. See MessageV2.cursor.
 */
function synthesizeCursor(oldest: { info: { id: string; time: { created: number } } }): string {
  const payload = JSON.stringify({ id: oldest.info.id, time: oldest.info.time.created })
  return Buffer.from(payload, "utf8").toString("base64url")
}

export async function fetchMessagePage(
  client: KiloClient,
  input: {
    sessionID: string
    workspaceDir: string
    limit: number
    before?: string
    signal?: AbortSignal
  },
) {
  // limit: 0 is the server contract for "return every message" — used by
  // the sub-agent viewer, which has no "load earlier" UI.
  const full = input.limit === 0
  const read = async (before?: string) => {
    const result = await retry(() =>
      client.session.messages(
        { sessionID: input.sessionID, directory: input.workspaceDir, limit: input.limit, before },
        { throwOnError: true, signal: input.signal },
      ),
    )
    // When a proxy/auth gateway strips X-Next-Cursor but the response fills
    // the requested limit, synthesize a cursor from the oldest item so the
    // "load earlier" path keeps working. Risk of one extra empty request is
    // preferable to silently hiding older history. Never synthesize for
    // full loads — those return everything by contract.
    const items = result.data
    const header = result.response.headers.get("X-Next-Cursor")
    const cursor = full
      ? undefined
      : (header ?? (items.length >= input.limit && items[0] ? synthesizeCursor(items[0]) : undefined))
    return { items, cursor }
  }

  const fill = async (page: Awaited<ReturnType<typeof read>>, depth = 0): Promise<Awaited<ReturnType<typeof read>>> => {
    if (page.items[0]?.info.role !== "assistant") return page
    if (depth >= FILL_LIMIT) return page
    if (!page.cursor || input.signal?.aborted) return page
    const next = await read(page.cursor)
    const items = [...next.items, ...page.items]
    return fill({ items, cursor: next.cursor }, depth + 1)
  }

  return fill(await read(input.before))
}
