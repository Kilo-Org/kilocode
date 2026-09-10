import type { KiloClient } from "../backend/index"
import { retry } from "../services/cli-backend/retry"

export const MESSAGE_PAGE_LIMIT = 80

// Bound assistant-boundary backfill so corrupt histories cannot load an entire session.
const FILL_LIMIT = 2

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
  const read = async (before?: string) => {
    const result = await retry(() =>
      client.session.page(
        { sessionID: input.sessionID, directory: input.workspaceDir, limit: input.limit, before },
        { throwOnError: true, signal: input.signal },
      ),
    )
    // Native cursors are opaque and returned in the body, never synthesized from view IDs.
    return result.data
  }

  const fill = async (page: Awaited<ReturnType<typeof read>>, depth = 0): Promise<Awaited<ReturnType<typeof read>>> => {
    if (page.items.length && page.items[0]?.info.role !== "assistant") return page
    if (depth >= FILL_LIMIT) return page
    if (!page.cursor || input.signal?.aborted) return page
    const next = await read(page.cursor)
    const items = [...next.items, ...page.items]
    return fill({ items, cursor: next.cursor }, depth + 1)
  }

  return fill(await read(input.before))
}
