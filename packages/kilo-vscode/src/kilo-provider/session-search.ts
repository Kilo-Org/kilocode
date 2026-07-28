import type { KiloClient } from "@kilocode/sdk/v2/client"

type Item = {
  id: string
  title: string
  updated: number
}

type Message = {
  requestId: string
  sessionID?: string
}

type Input = {
  client: KiloClient | null
  message: Message
  current?: string
  context?: string
  dir: (id?: string) => string
  exclude?: string
  post: (message: unknown) => void
}

/**
 * Past-chat mention search. Lists root sessions for the directory the current
 * chat runs in (workspace root for the sidebar, the worktree for Agent Manager
 * sessions) — the same directory-scoped `session.list` the session history and
 * Agent Manager search are built on. Fuzzy title filtering happens in the
 * webview (same mechanism as the Agent Manager sidebar search).
 */
export async function handleSessionSearch(input: Input): Promise<void> {
  const client = input.client
  if (!client) {
    input.post({ type: "sessionSearchResult", sessions: [], requestId: input.message.requestId })
    return
  }

  const id = input.message.sessionID ?? input.current ?? input.context
  const dir = input.dir(id)

  try {
    const res = await client.session.list({ directory: dir, roots: true, limit: 50 }, { throwOnError: true })
    const sessions: Item[] = res.data
      .filter((session) => session.id !== input.exclude && session.title)
      .map((session) => ({ id: session.id, title: session.title, updated: session.time.updated }))
    input.post({ type: "sessionSearchResult", sessions, requestId: input.message.requestId })
  } catch (err) {
    console.error("[Kilo New] Session search failed:", err)
    input.post({ type: "sessionSearchResult", sessions: [], requestId: input.message.requestId })
  }
}
