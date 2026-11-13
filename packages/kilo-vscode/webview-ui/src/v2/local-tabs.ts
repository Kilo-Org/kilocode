// The sidebar's local session tabs on native v2 data. A tab is a root session of this directory or a pending draft
// composer. The order, pins and the active tab survive a reload in the webview state, as on main.
import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { sessionActivity, type Activity } from "../../agent-manager/v2/activity"
import { useVSCode } from "../context/vscode"
import {
  PENDING_TAB_PREFIX,
  addPendingTab,
  closeOtherTabs,
  closeTab,
  insertSessionTabAfter,
  isPendingTab,
  openSessionTab,
  replacePendingTab,
  restoreTabs,
  type LocalTabState,
} from "../utils/local-tabs"
import { applyPinnedTabs, reorderPinnedTabs, togglePinnedTab } from "../utils/tab-order"
import { useV2 } from "./client"
import { promptDrafts } from "./prompt"
import { attachmentDrafts, pasteDrafts } from "./prompt-attachments"
import { sessionMissing } from "./scope"

interface StoredTabs extends Record<string, unknown> {
  sidebarSessionTabIDs?: string[]
  sidebarActiveSessionTabID?: string
  sidebarPinnedSessionTabIDs?: string[]
}

export interface LocalTabsValue {
  ids: Accessor<string[]>
  display: Accessor<string[]>
  active: Accessor<string>
  session: Accessor<string | undefined>
  add: () => string
  open: (id: string) => void
  openAfter: (source: string, id: string) => void
  select: (id: string) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeToRight: (id: string) => void
  closableRight: (id: string) => string[]
  settled: (draftKey: string, id: string) => void
  step: (offset: -1 | 1) => void
  isPinned: (id: string) => boolean
  togglePinned: (id: string) => void
  reorder: (from: string, to: string) => boolean
  move: (id: string, offset: -1 | 1) => number | undefined
  persist: () => void
  activity: (id: string) => Activity
}

const same = (left: string[], right: string[]) => left.length === right.length && left.every((id, i) => right[i] === id)

export function createLocalTabs(): LocalTabsValue {
  const v2 = useV2()
  const vscode = useVSCode()
  const saved = vscode.getState<StoredTabs>()
  const pending = () => `${PENDING_TAB_PREFIX}${crypto.randomUUID()}`
  const init = restoreTabs(saved?.sidebarSessionTabIDs, saved?.sidebarActiveSessionTabID, pending)
  // restoreTabs normalizes to at least one tab, so these fallbacks keep the accessor type non-optional.
  const [ids, setIds] = createSignal(init.ids)
  const [active, setActive] = createSignal(init.active ?? init.ids[0])
  const [pinned, setPinned] = createSignal(
    (saved?.sidebarPinnedSessionTabIDs ?? []).filter((id) => !isPendingTab(id)),
  )

  const current = (): LocalTabState => ({ ids: ids(), active: active() })
  const apply = (next: LocalTabState) => {
    const nextActive = next.active ?? next.ids[0]
    if (!same(ids(), next.ids)) setIds(next.ids)
    if (nextActive && active() !== nextActive) setActive(nextActive)
  }
  const display = createMemo(() =>
    applyPinnedTabs(
      ids().map((id) => ({ id })),
      pinned(),
    ).map((item) => item.id),
  )
  const isPinned = (id: string) => pinned().includes(id)
  const togglePinned = (id: string) => {
    if (isPendingTab(id)) return
    setPinned((prev) => togglePinnedTab(prev, id))
  }
  const session = () => {
    const id = active()
    return isPendingTab(id) ? undefined : id
  }
  const select = (id: string) => {
    if (!ids().includes(id)) return
    setActive(id)
  }

  const open = (id: string) => {
    apply(openSessionTab(current(), id))
  }

  const openAfter = (source: string, id: string) => {
    apply(insertSessionTabAfter(current(), source, id))
  }

  const add = () => {
    const id = pending()
    apply(addPendingTab(current(), id))
    return id
  }

  // Pending ids are one-shot, so their drafts, attachments and paste backing would never be reused.
  const clearDraft = (id: string) => {
    promptDrafts.set(id, "")
    attachmentDrafts.set(id, [])
    pasteDrafts.set(id, [])
  }

  const dropDraft = (id: string) => {
    if (!isPendingTab(id)) return
    // The composer unmounts after this, and its cleanup writes the draft back. Clear it after that write.
    queueMicrotask(() => clearDraft(id))
  }

  const close = (id: string) => {
    if (!ids().includes(id)) return
    apply(closeTab(current(), id, pending))
    setPinned((prev) => prev.filter((tab) => tab !== id))
    dropDraft(id)
  }

  const closeOthers = (id: string) => {
    if (!ids().includes(id)) return
    const removed = ids().filter((tab) => tab !== id && !pinned().includes(tab))
    apply(closeOtherTabs(current(), id, pinned()))
    removed.forEach(dropDraft)
  }

  const closableRight = (id: string) => {
    const order = display()
    const index = order.indexOf(id)
    if (index < 0) return []
    return order.slice(index + 1).filter((tab) => !isPinned(tab))
  }

  const closeToRight = (id: string) => {
    const closing = new Set(closableRight(id))
    if (closing.size === 0) return
    setIds((prev) => prev.filter((tab) => !closing.has(tab)))
    if (closing.has(active())) setActive(id)
    closing.forEach(dropDraft)
  }

  // A created session takes the place of the pending tab that started it. It only becomes active when that tab was
  // still active, so a prompt that finishes after the user switched tabs does not pull them away.
  const settled = (draftKey: string, id: string) => {
    if (draftKey === id) {
      if (!ids().includes(id)) open(id)
      return
    }
    if (isPendingTab(draftKey)) {
      const next = replacePendingTab(current(), draftKey, id)
      apply(next)
      clearDraft(draftKey)
      return
    }
    if (!ids().includes(id)) open(id)
  }

  const step = (offset: -1 | 1) => {
    const order = display()
    const index = order.indexOf(active())
    const next = index === -1 ? undefined : order[index + offset]
    if (next) select(next)
  }

  const reorder = (from: string, to: string) => {
    const next = reorderPinnedTabs(ids(), pinned(), from, to)
    if (!next) return false
    setIds(next.ids)
    setPinned(next.pinned)
    return true
  }

  const move = (id: string, offset: -1 | 1) => {
    const list = display()
    const index = list.indexOf(id)
    if (index === -1) return undefined
    const target = list[index + offset]
    if (target === undefined) return undefined
    if (!reorder(id, target)) return undefined
    return display().indexOf(id)
  }

  // Validate the restored tabs once the store is connected. Saved tabs outside the first page are not in the store
  // yet, so sync each one; only a session the server reports as missing closes its tab.
  let validated = false
  createEffect(
    on(v2.connection.status, (status) => {
      if (status !== "connected" || validated) return
      validated = true
      for (const id of ids()) {
        if (isPendingTab(id) || v2.data.session.get(id)) continue
        void v2.data.session.sync(id).catch((error: unknown) => {
          if (sessionMissing(error)) close(id)
        })
      }
    }),
  )

  onCleanup(
    v2.data.on("session.deleted", (event) => {
      close(event.data.sessionID)
    }),
  )

  const activity = (id: string) =>
    isPendingTab(id)
      ? "idle"
      : sessionActivity(v2.data, id, v2.connection.status() === "connected", v2.scheduled(id))

  let timer: ReturnType<typeof setTimeout> | undefined
  const persist = () => {
    const tabs = ids().filter((id) => !isPendingTab(id))
    const tab = active()
    const selected = isPendingTab(tab) ? undefined : tab
    const pins = pinned().filter((id) => tabs.includes(id))
    const previous = vscode.getState<StoredTabs>() ?? {}
    vscode.setState({
      ...previous,
      sidebarSessionTabIDs: tabs,
      sidebarActiveSessionTabID: selected,
      sidebarPinnedSessionTabIDs: pins,
    })
  }
  createEffect(() => {
    ids()
    active()
    pinned()
    clearTimeout(timer)
    timer = setTimeout(persist, 300)
  })
  onCleanup(() => clearTimeout(timer))

  return {
    ids,
    display,
    active,
    session,
    add,
    open,
    openAfter,
    select,
    close,
    closeOthers,
    closeToRight,
    closableRight,
    settled,
    step,
    isPinned,
    togglePinned,
    reorder,
    move,
    persist,
    activity,
  }
}
