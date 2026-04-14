import type { KiloClient } from "@kilocode/sdk/v2/client"
import { retry } from "../services/cli-backend/retry"

export const MESSAGE_PAGE_LIMIT = 80

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
      client.session.messages(
        { sessionID: input.sessionID, directory: input.workspaceDir, limit: input.limit, before },
        { throwOnError: true, signal: input.signal },
      ),
    )
    const cursor = result.response.headers.get("X-Next-Cursor") ?? undefined
    return {
      items: result.data,
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
