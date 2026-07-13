import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type ParentComponent,
  useContext,
} from "solid-js"
import { useServer } from "./server"
import { useSession } from "./session"
import { useVSCode } from "./vscode"
import {
  PENDING_TAB_PREFIX,
  addPendingTab,
  addSessionTab,
  closeOtherTabs,
  closeTab,
  insertSessionTabAfter,
  isPendingTab,
  openSessionTab,
  pendingTabForCreated,
  reconcileTabs,
  replacePendingTab,
  restoreTabs,
  type LocalTabState,
} from "../utils/local-tabs"
import {
  deletePendingDraft,
  discardPendingDraft,
  isPendingSend,
  promotePendingDraftDiscard,
} from "../utils/draft-store"
import { moveTab, reorderTabs } from "../utils/tab-order"

interface LocalTabsState extends Record<string, unknown> {
  sidebarSessionTabIDs?: string[]
  sidebarActiveSessionTabID?: string
}

interface LocalTabsValue {
  ids: Accessor<string[]>
  active: Accessor<string | undefined>
  pending: Accessor<string | undefined>
  add: () => string
  open: (id: string) => void
  openAfter: (source: string, id: string) => void
  select: (id: string) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  previewCloud: (id: string) => void
  reorder: (from: string, to: string) => boolean
  move: (id: string, offset: -1 | 1) => number | undefined
  persist: () => void
}

const LocalTabsContext = createContext<LocalTabsValue>()

const same = (left: string[], right: string[]) => left.length === right.length && left.every((id, i) => right[i] === id)

export const LocalTabsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const session = useSession()
  const saved = vscode.getState<LocalTabsState>()
  const pending = () => `${PENDING_TAB_PREFIX}${crypto.randomUUID()}`
  const init = restoreTabs(saved?.sidebarSessionTabIDs, saved?.sidebarActiveSessionTabID, pending)
  const [ids, setIds] = createSignal(init.ids)
  const [active, setActive] = createSignal(init.active)
  const [cloud, setCloud] = createSignal<string>()
  const fresh = new Set<string>()
  const current = (): LocalTabState => ({ ids: ids(), active: active() })
  const apply = (next: LocalTabState) => {
    if (!same(ids(), next.ids)) setIds(next.ids)
    if (active() !== next.active) setActive(next.active)
  }
  const focus = (id: string | undefined) => {
    setCloud(undefined)
    if (!id || isPendingTab(id)) {
      session.clearCurrentSession()
      return
    }
    session.selectSession(id)
  }
  const real = createMemo(() => ids().filter((id) => !isPendingTab(id)))
  const activePending = createMemo(() => {
    const id = active()
    return id && isPendingTab(id) ? id : undefined
  })

  const select = (id: string) => {
    if (!ids().includes(id)) return
    setActive(id)
    focus(id)
  }

  const open = (id: string) => {
    apply(openSessionTab(current(), id))
    focus(id)
  }

  const openAfter = (source: string, id: string) => {
    apply(insertSessionTabAfter(current(), source, id))
    focus(id)
    persist()
  }

  const add = () => {
    const id = pending()
    apply(addPendingTab(current(), id))
    focus(id)
    return id
  }

  const close = (id: string) => {
    const before = active()
    const next = closeTab(current(), id, pending)
    apply(next)
    if (before === id || before !== next.active) focus(next.active)
    if (isPendingTab(id)) {
      if (session.isSubmitting(id) || isPendingSend(id)) discardPendingDraft(id)
      queueMicrotask(() => deletePendingDraft(id))
    }
  }

  const closeOthers = (id: string) => {
    const removed = ids().filter((tab) => tab !== id && isPendingTab(tab))
    const next = closeOtherTabs(current(), id)
    apply(next)
    focus(next.active)
    for (const pending of removed) {
      if (session.isSubmitting(pending) || isPendingSend(pending)) discardPendingDraft(pending)
    }
    queueMicrotask(() => removed.forEach(deletePendingDraft))
  }
  const previewCloud = (id: string) => setCloud(id)
  const reorder = (from: string, to: string) => {
    const next = reorderTabs(ids(), from, to)
    if (!next) return false
    setIds(next)
    return true
  }
  const move = (id: string, offset: -1 | 1) => {
    const next = moveTab(ids(), id, offset)
    if (!next) return undefined
    setIds(next)
    return next.indexOf(id)
  }

  let restored = false
  createEffect(() => {
    if (restored || !server.isConnected()) return
    restored = true
    if (real().length > 0) session.loadSessions()
    const id = active()
    if (id && !isPendingTab(id)) session.selectSession(id)
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const persist = () => {
    const tabs = real()
    const tab = active()
    const selected = tab && !isPendingTab(tab) ? tab : undefined
    const prev = vscode.getState<LocalTabsState>() ?? {}
    vscode.setState({ ...prev, sidebarSessionTabIDs: tabs, sidebarActiveSessionTabID: selected })
  }
  createEffect(() => {
    real()
    active()
    clearTimeout(timer)
    timer = setTimeout(persist, 300)
  })
  onCleanup(() => clearTimeout(timer))

  createEffect(() => {
    vscode.postMessage({ type: "sidebar.openSessions", sessionIDs: real() })
  })

  onMount(() => {
    const cleanup = vscode.onMessage((message) => {
      if (message.type === "openCloudSession") {
        setCloud(message.sessionId)
        return
      }
      if (message.type === "sessionCreated") {
        if (message.draftID && promotePendingDraftDiscard(message.draftID, message.session.id)) return
        const draft = pendingTabForCreated(ids(), message.draftID)
        if (!draft) return
        const before = active()
        const next = replacePendingTab(current(), draft, message.session.id)
        fresh.add(message.session.id)
        apply(next)
        focus(next.active)
        return
      }
      if (message.type === "cloudSessionImported") {
        const activate = cloud() === message.cloudSessionId
        fresh.add(message.session.id)
        apply(activate ? openSessionTab(current(), message.session.id) : addSessionTab(current(), message.session.id))
        if (activate) setCloud(undefined)
        return
      }
      if (message.type === "sessionsLoaded") {
        const before = active()
        const listed = message.sessions.map((item) => item.id)
        for (const id of listed) fresh.delete(id)
        const next = reconcileTabs(current(), [...listed, ...(message.preserveSessionIds ?? []), ...fresh], pending)
        apply(next)
        if (before !== next.active) focus(next.active)
        return
      }
      if (message.type === "sessionDeleted") {
        fresh.delete(message.sessionID)
        const before = active()
        const next = closeTab(current(), message.sessionID, pending)
        apply(next)
        if (before !== next.active) focus(next.active)
      }
    })
    onCleanup(cleanup)
  })

  return (
    <LocalTabsContext.Provider
      value={{
        ids,
        active,
        pending: activePending,
        add,
        open,
        openAfter,
        select,
        close,
        closeOthers,
        previewCloud,
        reorder,
        move,
        persist,
      }}
    >
      {props.children}
    </LocalTabsContext.Provider>
  )
}

export function useLocalTabs(): LocalTabsValue | undefined {
  return useContext(LocalTabsContext)
}
