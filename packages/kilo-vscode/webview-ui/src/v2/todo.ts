// v2 bindings for the session dock todo chip: read the latest todowrite output from the session message store.
import { createEffect, createMemo, type Accessor } from "solid-js"
import type { TodoDockSource } from "../components/chat/todo/todo-dock"
import { useV2 } from "./client"
import { hasTodoWrite, todoEnabled, todoState } from "./todo-state"

/** The chip reads this source; the store updates it as messages stream in. */
export function useTodoSource(id: Accessor<string | undefined>): TodoDockSource {
  const v2 = useV2()
  const entries = () => v2.data.location.config.list() ?? []

  // The chat does not sync config for other features, so read it once to know
  // whether the experimental todo tool can produce a list at all.
  let synced = false
  createEffect(() => {
    if (synced) return
    synced = true
    if (entries().length > 0) return
    void v2.data.location.config.sync().catch(v2.report)
  })

  const state = createMemo(() => {
    const session = id()
    const messages = session ? v2.data.session.message.list(session) : []
    return todoState(messages, session ? v2.data.session.get(session)?.revert : undefined)
  })

  // The initial sync loads a short window of recent messages. If no write is in
  // that window, walk older pages until a write appears. Only sessions with the
  // tool enabled pay for this, and the set keeps a failed load from retrying on
  // every streamed message.
  const paged = new Set<string>()
  createEffect(() => {
    const session = id()
    if (!session || paged.has(session)) return
    const messages = v2.data.session.message.list(session)
    // Nothing is loaded yet. The sync that follows will run this effect again.
    if (messages.length === 0) return
    const revert = v2.data.session.get(session)?.revert
    if (hasTodoWrite(messages, revert)) {
      paged.add(session)
      return
    }
    // Config may still be loading; this effect runs again when it arrives.
    if (!todoEnabled(entries())) return
    paged.add(session)
    if (!v2.data.session.message.more(session)) return
    void page(session, revert).catch(v2.report)
  })

  async function page(session: string, revert: { messageID: string; partID?: string } | undefined) {
    while (v2.data.session.message.more(session)) {
      if (hasTodoWrite(v2.data.session.message.list(session), revert)) return
      await v2.data.session.message.loadMore(session)
    }
  }

  return {
    id,
    items: () => state().items,
    last: () => state().last,
    user: () => state().user,
  }
}