import type { KiloClient } from "@kilocode/sdk/v2/client"
import { retry } from "../services/cli-backend/retry"

export const MESSAGE_PAGE_LIMIT = 80

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
  // limit: 0 is the server contract for "no pagination, return every message"
  // — used by the sub-agent viewer which has no "load earlier" UI.
  const full = input.limit === 0
  const read = async (before?: string) => {
    const result = await retry(() =>
      client.session.messages(
        {
          sessionID: input.sessionID,
          directory: input.workspaceDir,
          ...(full ? {} : { limit: input.limit }),
          ...(before ? { before } : {}),
        },
        { throwOnError: true, signal: input.signal },
      ),
    )
    // The server sets X-Next-Cursor when more pages exist. CORS proxies, auth
    // gateways, or older binaries may strip the header. When the response
    // fills the requested limit, fall back to a client-synthesized cursor so
    // "load earlier" keeps working. A full response usually means more exists
    // — the risk of one extra empty request is preferable to silently hiding
    // older history. The fallback does NOT apply to full loads (limit: 0):
    // those return everything by contract and must not synthesize a cursor.
    const header = result.response.headers.get("X-Next-Cursor") ?? undefined
    const items = result.data
    const oldest = items[0]
    const cursor = full
      ? undefined
      : (header ?? (items.length >= input.limit && oldest ? synthesizeCursor(oldest) : undefined))
    return {
      items,
      cursor,
    }
  }

  const suffix = (items: Awaited<ReturnType<typeof read>>["items"]) => {
    const index = [...items].reverse().findIndex((item) => item.info.role === "user")
    if (index === -1) return items
    return items.slice(items.length - index - 1)
  }

  const fill = async (page: Awaited<ReturnType<typeof read>>): Promise<Awaited<ReturnType<typeof read>>> => {
    if (page.items[0]?.info.role !== "assistant") return page
    if (!page.cursor || input.signal?.aborted) return page
    const next = await read(page.cursor)
    const items = [...suffix(next.items), ...page.items]
    return fill({ items, cursor: next.cursor })
  }

  return fill(await read(input.before))
}
