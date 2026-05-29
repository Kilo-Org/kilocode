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
  closeTab,
  isPendingTab,
  openSessionTab,
  reconcileTabs,
  replacePendingTab,
  restoreTabs,
  type LocalTabState,
} from "../utils/local-tabs"

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
  select: (id: string) => void
  close: (id: string) => void
}

const LocalTabsContext = createContext<LocalTabsValue>()

const same = (left: string[], right: string[]) => left.length === right.length && left.every((id, i) => right[i] === id)

export const LocalTabsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const session = useSession()
  const saved = vscode.getState<LocalTabsState>()
  let count = 0
  const pending = () => `${PENDING_TAB_PREFIX}${++count}`
  const init = restoreTabs(saved?.sidebarSessionTabIDs, saved?.sidebarActiveSessionTabID, pending)
  const [ids, setIds] = createSignal(init.ids)
  const [active, setActive] = createSignal(init.active)
  const fresh = new Set<string>()
  const current = (): LocalTabState => ({ ids: ids(), active: active() })
  const apply = (next: LocalTabState) => {
    if (!same(ids(), next.ids)) setIds(next.ids)
    if (active() !== next.active) setActive(next.active)
  }
  const focus = (id: string | undefined) => {
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
  createEffect(() => {
    const tabs = real()
    const tab = active()
    const selected = tab && !isPendingTab(tab) ? tab : undefined
    clearTimeout(timer)
    timer = setTimeout(() => {
      const prev = vscode.getState<LocalTabsState>() ?? {}
      vscode.setState({ ...prev, sidebarSessionTabIDs: tabs, sidebarActiveSessionTabID: selected })
    }, 300)
  })
  onCleanup(() => clearTimeout(timer))

  createEffect(() => {
    vscode.postMessage({ type: "sidebar.openSessions", sessionIDs: real() })
  })

  onMount(() => {
    const cleanup = vscode.onMessage((message) => {
      if (message.type === "sessionCreated") {
        const draft = message.draftID && ids().includes(message.draftID) ? message.draftID : activePending()
        if (!draft) return
        const before = active()
        const next = replacePendingTab(current(), draft, message.session.id)
        fresh.add(message.session.id)
        apply(next)
        if (before !== next.active) focus(next.active)
        return
      }
      if (message.type === "cloudSessionImported") {
        fresh.add(message.session.id)
        apply(openSessionTab(current(), message.session.id))
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
    <LocalTabsContext.Provider value={{ ids, active, pending: activePending, add, open, select, close }}>
      {props.children}
    </LocalTabsContext.Provider>
  )
}

export function useLocalTabs(): LocalTabsValue | undefined {
  return useContext(LocalTabsContext)
}
