import type { KiloClient } from "@kilocode/sdk/v2/client"

type Item = {
  id: string
  title: string
  updated: number
  worktreeName?: string
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
 * Past-chat mention search. Lists root sessions across the current directory's
 * worktree family (the repo root and its sibling worktrees for git projects,
 * just the directory itself otherwise) — the same family-wide listing the
 * Agent Manager session search and the CLI's past-chat picker are built on.
 * Every session in the family shares the project, so any of them can be
 * attached regardless of which worktree the current chat runs in. Fuzzy title
 * filtering happens in the webview (same mechanism as the Agent Manager
 * sidebar search).
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
    const res = await client.experimental.session.list(
      { worktrees: true, roots: true, directory: dir, limit: 5_000 },
      { throwOnError: true },
    )
    const sessions: Item[] = res.data
      .filter((session) => session.id !== input.exclude && session.title)
      .map((session) => ({
        id: session.id,
        title: session.title,
        updated: session.time.updated,
        worktreeName: session.worktreeName,
      }))
    input.post({ type: "sessionSearchResult", sessions, requestId: input.message.requestId })
  } catch (err) {
    console.error("[Kilo New] Session search failed:", err)
    input.post({ type: "sessionSearchResult", sessions: [], requestId: input.message.requestId })
  }
}
