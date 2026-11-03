// v2 bindings for the session dock todo chip: read the latest todowrite output from the session message store.
import { createEffect, createMemo, type Accessor } from "solid-js"
import type { TodoDockSource } from "../components/chat/todo/todo-dock"
import { useV2 } from "./client"
import { hasTodoWrite, todoState } from "./todo-state"

/** The chip reads this source; the store updates it as messages stream in. */
export function useTodoSource(id: Accessor<string | undefined>): TodoDockSource {
  const v2 = useV2()
  const state = createMemo(() => {
    const session = id()
    const messages = session ? v2.data.session.message.list(session) : []
    return todoState(messages, session ? v2.data.session.get(session)?.revert : undefined)
  })
  // The initial sync loads a short window of recent messages. If no write is in
  // that window, the current list is older, so load the rest once. The set keeps
  // a failed load from retrying on every streamed message.
  const paged = new Set<string>()
  createEffect(() => {
    const session = id()
    if (!session || paged.has(session)) return
    const messages = v2.data.session.message.list(session)
    // Nothing is loaded yet. The sync that follows will run this effect again.
    if (messages.length === 0) return
    paged.add(session)
    const revert = v2.data.session.get(session)?.revert
    if (hasTodoWrite(messages, revert)) return
    if (!v2.data.session.message.more(session)) return
    void v2.data.session.message.loadMore(session, { all: true })
  })
  return {
    id,
    items: () => state().items,
    last: () => state().last,
    user: () => state().user,
  }
}