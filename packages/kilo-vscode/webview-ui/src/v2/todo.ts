// v2 bindings for the session dock todo chip: read the latest todowrite output from the session message store.
import { createMemo, type Accessor } from "solid-js"
import type { TodoDockSource } from "../components/chat/todo/todo-dock"
import { useV2 } from "./client"
import { todoState } from "./todo-state"

/** The chip reads this source; the store updates it as messages stream in. */
export function useTodoSource(id: Accessor<string | undefined>): TodoDockSource {
  const v2 = useV2()
  const state = createMemo(() => {
    const session = id()
    const messages = session ? v2.data.session.message.list(session) : []
    return todoState(messages, session ? v2.data.session.get(session)?.revert : undefined)
  })
  return {
    id,
    items: () => state().items,
    last: () => state().last,
    user: () => state().user,
  }
}