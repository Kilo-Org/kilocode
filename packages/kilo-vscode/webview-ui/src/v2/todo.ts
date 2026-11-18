// v2 bindings for the session dock todo chip: read the latest todowrite output from the session message store.
import { createEffect, createMemo, type Accessor } from "solid-js"
import type { TodoDockSource } from "../components/chat/todo/todo-dock"
import { useV2 } from "./client"
import { hasTodoWrite, todoState } from "./todo-state"

/** How many older message pages the chip reads before it treats the list as absent. */
const PAGE_LIMIT = 25

/** The chip reads this source; the store updates it as messages stream in. */
export function useTodoSource(id: Accessor<string | undefined>): TodoDockSource {
  const v2 = useV2()

  const state = createMemo(() => {
    const session = id()
    const messages = session ? v2.data.session.message.list(session) : []
    return todoState(messages, session ? v2.data.session.get(session)?.revert : undefined)
  })

  // The initial sync loads a short window of recent messages. If no write is in
  // that window, walk older pages until a write appears. The set keeps a failed
  // load from retrying on every streamed message. A revert can hide the only loaded
  // write, so each revert boundary gets its own walk.
  const paged = new Set<string>()
  createEffect(() => {
    const session = id()
    const revert = session ? v2.data.session.get(session)?.revert : undefined
    const key = `${session}:${revert?.messageID ?? ""}`
    if (!session || paged.has(key)) return
    const messages = v2.data.session.message.list(session)
    // Nothing is loaded yet. The sync that follows will run this effect again.
    if (messages.length === 0) return
    paged.add(key)
    if (hasTodoWrite(messages, revert) || !v2.data.session.message.more(session)) return
    void page(session, revert).catch(v2.report)
  })

  async function page(session: string, revert: { messageID: string; partID?: string } | undefined) {
    let pages = 0
    // A list older than this many pages is stale. Without the bound, a session
    // that never wrote one would load its whole transcript on the first open.
    while (pages < PAGE_LIMIT && v2.data.session.message.more(session)) {
      if (hasTodoWrite(v2.data.session.message.list(session), revert)) return
      await v2.data.session.message.loadMore(session)
      pages += 1
    }
  }

  return {
    id,
    items: () => state().items,
    last: () => state().last,
    user: () => state().user,
  }
}