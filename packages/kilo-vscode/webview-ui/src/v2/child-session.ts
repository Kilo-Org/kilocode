import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"

/** The tool parts of a child session, in message order, for a subagent card. */
export function childTools(messages: readonly SessionMessageInfo[]) {
  return messages.flatMap((message) =>
    message.type === "assistant"
      ? message.content.filter((part): part is SessionMessageAssistantTool => part.type === "tool")
      : [],
  )
}

type ChildSessionData = {
  session: {
    message: {
      list: (sessionID: string) => readonly SessionMessageInfo[]
      sync: (sessionID: string) => Promise<unknown>
      more: (sessionID: string) => boolean
      loadMore: (sessionID: string) => Promise<unknown>
    }
    status: (sessionID: string) => string | undefined
    root: (sessionID: string) => string
    evict: (sessionID: string) => void
  }
}

/**
 * Loads the child histories a subagent card asks for. The page cap keeps a long child transcript from paging without
 * bound; leaving a session tree releases every child loaded from it.
 */
export function createChildSessions(input: {
  data: ChildSessionData
  report: (error: unknown) => void
  pages?: number
}) {
  const loaded = new Set<string>()
  const hydrate = async (sessionID: string) => {
    await input.data.session.message.sync(sessionID)
    for (let page = 0; page < (input.pages ?? 4) && input.data.session.message.more(sessionID); page++) {
      await input.data.session.message.loadMore(sessionID)
    }
  }
  const load = async (sessionID: string) => {
    if (loaded.has(sessionID)) return
    loaded.add(sessionID)
    try {
      await hydrate(sessionID)
    } catch (error) {
      loaded.delete(sessionID)
      input.report(error)
    }
  }
  const resync = () =>
    Promise.all(
      [...loaded].map(async (sessionID) => {
        try {
          await hydrate(sessionID)
        } catch (error) {
          loaded.delete(sessionID)
          input.report(error)
        }
      }),
    )
  const evict = (roots: Iterable<string>) => {
    for (const root of new Set(roots)) input.data.session.evict(root)
  }
  const release = (sessionID?: string) => {
    const roots = sessionID
      ? [input.data.session.root(sessionID)]
      : [...loaded].map((id) => input.data.session.root(id))
    loaded.clear()
    evict(roots)
  }
  const switchTo = (sessionID: string | undefined, previous: string | undefined) => {
    if (!previous || previous === sessionID) return
    if (sessionID !== undefined && input.data.session.root(sessionID) === input.data.session.root(previous)) return
    loaded.clear()
    input.data.session.evict(input.data.session.root(previous))
  }
  return { hydrate, load, resync, release, switchTo, loaded }
}
