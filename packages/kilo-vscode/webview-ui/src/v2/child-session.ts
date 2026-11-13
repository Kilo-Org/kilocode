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
      invalidate: (sessionID: string) => void
      more: (sessionID: string) => boolean
      loadMore: (sessionID: string) => Promise<unknown>
      /** Drops one session's cached messages. The tree evict would also drop the parent chat another view shows. */
      evict: (sessionID: string) => void
    }
    status: (sessionID: string) => string | undefined
    root: (sessionID: string) => string
  }
}

/**
 * Loads the child histories a subagent card asks for. The page cap keeps a long child transcript from paging without
 * bound; leaving a view releases the session it showed and the children it loaded.
 */
export function createChildSessions(input: {
  data: ChildSessionData
  report: (error: unknown) => void
  pages?: number
}) {
  const loaded = new Set<string>()
  const loading = new Set<string>()
  // Children whose history read ran once, including an empty first read.
  const hydrated = new Set<string>()
  // A cached child history can disappear while a card still shows the child: the inspector releases a subagent when
  // its tab closes, and a release drops the tree. The markers below only skip a child whose history is still there,
  // so a card that lost its transcript asks for it again instead of staying at the "Starting..." placeholder.
  const missing = (sessionID: string) => input.data.session.message.list(sessionID).length === 0
  const hydrate = async (sessionID: string) => {
    // The store completes the message sync of a session it sees created and builds that transcript from live events.
    // Fetch once when the first read is empty, so a missed event cannot leave the card without a history forever.
    if (!hydrated.has(sessionID) && missing(sessionID)) input.data.session.message.invalidate(sessionID)
    await input.data.session.message.sync(sessionID)
    hydrated.add(sessionID)
    for (let page = 0; page < (input.pages ?? 4) && input.data.session.message.more(sessionID); page++) {
      await input.data.session.message.loadMore(sessionID)
    }
  }
  const load = async (sessionID: string) => {
    if (loading.has(sessionID)) return
    if (loaded.has(sessionID) && !missing(sessionID)) return
    loaded.add(sessionID)
    loading.add(sessionID)
    try {
      await hydrate(sessionID)
    } catch (error) {
      loaded.delete(sessionID)
      input.report(error)
    } finally {
      loading.delete(sessionID)
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
  // Drop the given sessions from the message cache. This must be the single-session evict: the tree evict resolves
  // the root and also drops the parent transcript that another view is still showing.
  const evict = (ids: Iterable<string>) => {
    for (const id of new Set(ids)) input.data.session.message.evict(id)
  }
  const release = (sessionID?: string) => {
    const ids = sessionID ? [sessionID, ...loaded] : [...loaded]
    loaded.clear()
    hydrated.clear()
    evict(ids)
  }
  const switchTo = (sessionID: string | undefined, previous: string | undefined) => {
    if (!previous || previous === sessionID) return
    if (sessionID !== undefined && input.data.session.root(sessionID) === input.data.session.root(previous)) return
    const ids = [previous, ...loaded]
    loaded.clear()
    hydrated.clear()
    evict(ids)
  }
  return { hydrate, load, resync, release, switchTo, loaded }
}
