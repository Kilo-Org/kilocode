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
  // that window, the current list is older, so load the rest once. This runs at
  // most once per session because `more` turns false after `all` completes.
  createEffect(() => {
    const session = id()
    if (!session) return
    const revert = v2.data.session.get(session)?.revert
    if (hasTodoWrite(v2.data.session.message.list(session), revert)) return
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