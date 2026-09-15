import { createMemo, createSignal, type Accessor, type Setter } from "solid-js"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { LOCAL } from "./navigate"
import { applyTabOrder, reorderTabs } from "./tab-order"
import { isTerminalTabId, type TerminalStateControls } from "./terminal/state"
import { beginPromptMentionDrop, endPromptMentionDrop, sessionDrop } from "../src/utils/prompt-mention-drop"
import { outsideTabBar } from "../src/components/chat/TabDnd"

export function createTabDrag(opts: {
  selection: Accessor<string | null>
  sessions: Accessor<{ id: string; title?: string; updatedAt?: string }[]>
  review: { id: string; open: Accessor<boolean>; title: Accessor<string> }
  order: Accessor<Record<string, string[]>>
  setOrder: Setter<Record<string, string[]>>
  setLocal: (ids: string[]) => void
  terms: Pick<TerminalStateControls, "current" | "reorder" | "title">
  namespace: (key: string) => string
  persist: (key: string, order: string[]) => void
}) {
  const [dragging, setDragging] = createSignal<string>()
  const ids = createMemo(() => {
    const sessions = opts.sessions().map((s) => s.id)
    const key = opts.selection()
    if (key === null) return sessions
    const review = opts.review.open() ? [...sessions, opts.review.id] : sessions
    const base = [...review, ...opts.terms.current().map((t) => t.id)]
    return applyTabOrder(
      base.map((id) => ({ id })),
      opts.order()[key],
    ).map((item) => item.id)
  })
  const overlay = createMemo(() => {
    const id = dragging()
    if (!id) return undefined
    if (id === opts.review.id) return { id, title: opts.review.title() }
    if (isTerminalTabId(id)) {
      const title = opts.terms.title(id)
      return title ? { id, title } : undefined
    }
    return opts.sessions().find((s) => s.id === id)
  })

  return {
    ids,
    overlay,
    start(event: DragEvent) {
      const id = event.draggable?.id
      if (typeof id !== "string") return
      setDragging(id)
      if (isTerminalTabId(id)) {
        beginPromptMentionDrop({ kind: "terminal" })
        return
      }
      const session = opts.sessions().find((item) => item.id === id)
      if (session) beginPromptMentionDrop(sessionDrop(session))
    },
    over(event: DragEvent) {
      // Once the tab is below the bar it is on its way to the prompt, so stop
      // reordering the tabs under it.
      if (outsideTabBar(event)) return
      const from = event.draggable?.id
      const to = event.droppable?.id
      if (typeof from !== "string" || typeof to !== "string") return
      const key = opts.selection()
      if (key === null) return
      const order = reorderTabs(ids(), from, to)
      if (!order) return
      opts.setOrder((prev) => ({ ...prev, [key]: order }))
      if (key === LOCAL) opts.setLocal(order.filter((id) => id !== opts.review.id && !isTerminalTabId(id)))
      // Terminal slots use project-namespaced keys, unlike the mixed tab order.
      const terminals = order.filter(isTerminalTabId)
      if (terminals.length > 0) opts.terms.reorder(opts.namespace(key), terminals)
    },
    end() {
      endPromptMentionDrop()
      setDragging(undefined)
      const key = opts.selection()
      if (key === null) return
      const order = opts.order()[key]
      if (order && order.length > 0) opts.persist(key, order)
    },
  }
}
