import type { useSDK } from "../context/sdk"

/**
 * Past-chat @-mention support for the prompt autocomplete. Sessions are
 * searched through the same experimental list endpoint the /sessions dialog
 * uses, scoped to the current worktree, and inserted as `session:` file parts
 * that the server resolves into transcript context at prompt time.
 */

export type SessionMention = {
  id: string
  title: string
  updated: number
}

export async function fetchSessionMentions(
  sdk: ReturnType<typeof useSDK>,
  directory: string,
  query: string,
  limit = 30,
): Promise<SessionMention[]> {
  // A failed list call (server restarting, transient error) must not break the
  // prompt — the picker just shows no sessions, and the error stays visible
  // in the log instead of being swallowed.
  const result = await sdk.client.experimental.session
    .list(
      {
        search: query || undefined,
        roots: true,
        worktrees: true,
        current: "true",
        directory: directory || undefined,
        limit,
      },
      { throwOnError: true },
    )
    .catch((err) => {
      console.error("Failed to list past chats for mention picker:", err)
      return { data: [] }
    })
  return (result.data ?? [])
    .filter((item) => item.id && item.title)
    .map((item) => ({ id: item.id, title: item.title, updated: item.time.updated }))
}

/** Single-line display text inserted into the prompt for a session mention. */
export function sessionMentionText(title: string) {
  return title.replace(/\s+/g, " ").trim()
}

function sessionMentionFilename(title: string, id: string) {
  const slug =
    title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 50) || id
  return `${slug}.md`
}

export function createSessionPart(session: SessionMention) {
  const url = `session:${session.id}`
  const filename = sessionMentionFilename(sessionMentionText(session.title), session.id)
  return {
    filename,
    url,
    part: {
      type: "file" as const,
      mime: "text/plain",
      filename,
      url,
      source: {
        type: "file" as const,
        text: {
          start: 0,
          end: 0,
          value: "",
        },
        path: url,
      },
    },
  }
}

