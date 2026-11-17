/**
 * Where a session that a chat view created, or sent a prompt to, lands in the tab bar, and whether it takes the view.
 * A send is bound to the tab it was pressed in. A first send can wait for the sandbox default or a revert, and the
 * user can move to another tab or context meanwhile: the session then fills the draft tab it came from and the view
 * stays where the user is, as v1 did.
 */
import { openSessionTab, replacePendingTab } from "../src/utils/local-tabs"
import { LOCAL, sendFiling } from "./navigate"
import { replaceRememberedTab } from "./selection-actions"
import { replaceInTabOrder } from "./tab-order"

export type CreatedTab =
  | { kind: "keep" }
  | { kind: "local"; replace?: string; show: boolean }
  | { kind: "worktree"; worktree: string; show: boolean; append: boolean }

export function createdTab(input: {
  id: string
  /** The draft or session tab the send was pressed in. Absent when the server asked to show the session (plan handoff). */
  sent?: { key: string | undefined }
  /** The worktree the session belongs to (`sendFiling`), or null for Local. */
  worktree: string | null
  /** The session tabs that worktree shows. */
  worktreeTabs: readonly string[]
  selection: string | null
  local: readonly string[]
  activePending: string | undefined
  /** The session the chat shows now. */
  shown: string | undefined
  pending: (id: string) => boolean
}): CreatedTab {
  const key = input.sent?.key
  // A prompt to a session that already had a tab: keep its filing and leave the view alone.
  const existing = key !== undefined && key === input.id
  if (input.worktree) {
    // Every send reports its session; a tab the worktree already shows keeps its place.
    const append = !input.worktreeTabs.includes(input.id)
    if (existing || !input.sent) return { kind: "worktree", worktree: input.worktree, show: !existing, append }
    // A first send from a worktree's empty composer shows the session only while the user still looks at it.
    return {
      kind: "worktree",
      worktree: input.worktree,
      show: input.selection === input.worktree && input.shown === undefined,
      append,
    }
  }
  if (key && input.pending(key)) {
    // The user closed the draft while it was sent: the session stays in history without a tab.
    if (!input.local.includes(key)) return { kind: "keep" }
    return { kind: "local", replace: key, show: input.selection === LOCAL && input.activePending === key }
  }
  if (input.local.includes(input.id)) return { kind: "keep" }
  return { kind: "local", show: !existing || input.shown === input.id }
}

type BackgroundStore = {
  tabs: { ids: () => string[]; set: (ids: string[]) => void }
  tabOrder: () => Record<string, string[]>
  setTabOrder: (update: (prev: Record<string, string[]>) => Record<string, string[]>) => void
  tabMemory: { get: (key: string) => string | undefined; set: (key: string, tab: string) => void }
  sessionRestore: { get: (key: string) => string | undefined; set: (key: string, tab: string) => void }
}

/**
 * A Local session whose send resolved after the user switched to another project fills its draft tab in the project
 * it was created in, as v1's `backgroundCreated`, instead of leaving that draft empty next to a new tab.
 */
export function backgroundCreated(store: BackgroundStore, id: string, key: string | undefined) {
  const ids = store.tabs.ids()
  const draft = key && key !== id && ids.includes(key) ? key : undefined
  if (!draft && ids.includes(id)) return
  store.tabs.set(draft ? replacePendingTab({ ids }, draft, id).ids : openSessionTab({ ids }, id).ids)
  const order = store.tabOrder()[LOCAL] ?? []
  const next = (draft ? replaceInTabOrder(order, draft, id) : undefined) ?? [...order.filter((item) => item !== id), id]
  store.setTabOrder((prev) => ({ ...prev, [LOCAL]: next }))
  if (draft) replaceRememberedTab(store, LOCAL, draft, id)
}

/**
 * Files a session whose send resolved after the user switched to another project, in the project and context it was
 * created in, and leaves the current project alone.
 */
export function fileInOrigin(input: {
  id: string
  origin: { project: string | undefined; worktree: string | null }
  key: string | undefined
  store: (project: string) => BackgroundStore
  add: (worktree: string) => void
  persist: () => void
}) {
  // A prompt to a session that already had its tab needs no filing; adopting it again would end branch naming.
  if (input.key === input.id) return
  if (input.origin.worktree) return input.add(input.origin.worktree)
  if (input.origin.project) backgroundCreated(input.store(input.origin.project), input.id, input.key)
  input.persist()
}

type Origin = { project: string | undefined; worktree: string | null }

const QUIET = 30_000

/**
 * The panel's handler for a session a chat view created or sent a prompt to (`onSession`), and for the plan handoff.
 * It files the session in the context of its server directory (`sendFiling`) and places its tab with `createdTab`.
 */
export function createSessionCreated(deps: {
  project: () => string | undefined
  selection: () => string | null
  filed: (id: string) => string | null | undefined
  owner: (id: string) => string | null | undefined
  local: () => string[]
  worktreeTabs: (worktree: string) => string[]
  activePending: () => string | undefined
  shown: () => string | undefined
  pending: (id: string) => boolean
  store: (project: string) => BackgroundStore
  appendOrder: (key: string, id: string) => void
  post: (message: unknown) => void
  clear: () => void
  select: (id: string) => void
  current: () => string | undefined
  focusManaged: (worktree: string, id: string) => void
  placeLocal: (id: string, pending: string | undefined, active: string | undefined) => void
  setActivePending: (id: string | undefined) => void
  setSelection: (id: string) => void
  now?: () => number
}) {
  // Sessions filed in a worktree without taking the view; the host's sessionAdded reply must not focus them either.
  // The host can drop the request without a reply, so a mark expires instead of quieting a later open of the session.
  const quiet = new Map<string, number>()
  const addToWorktree = (project: string | undefined, worktreeId: string, sessionId: string) =>
    deps.post({ type: "agentManager.addSessionToWorktree", projectId: project, worktreeId, sessionId })
  const persist = (project: string | undefined, sessionId: string) =>
    deps.post({ type: "agentManager.persistSession", projectId: project, sessionId })

  const handle = (id: string | undefined, origin: Origin, sent?: { key: string | undefined }) => {
    if (!id) return deps.clear()
    // The project changed during the send: file the session in the project that created it and leave this one alone.
    if (origin.project !== deps.project())
      return fileInOrigin({
        id,
        origin,
        key: sent?.key,
        store: deps.store,
        add: (worktree) => addToWorktree(origin.project, worktree, id),
        persist: () => persist(origin.project, id),
      })
    const selection = deps.selection()
    const filed = deps.filed(id)
    const known = deps.owner(id)
    const worktree = sendFiling({
      selection,
      filed,
      local: deps.local().includes(id),
      owner: known === undefined ? origin.worktree : known,
    })
    const tab = createdTab({
      id,
      sent,
      worktree,
      worktreeTabs: worktree ? deps.worktreeTabs(worktree) : [],
      selection,
      local: deps.local(),
      activePending: deps.activePending(),
      shown: deps.shown(),
      pending: deps.pending,
    })
    if (tab.kind === "keep") return
    if (tab.kind === "worktree") {
      if (tab.append) deps.appendOrder(tab.worktree, id)
      // Adopting a session the worktree already owns would end its branch auto-naming.
      if (filed !== tab.worktree) {
        if (!tab.show) quiet.set(id, deps.now?.() ?? Date.now())
        addToWorktree(origin.project, tab.worktree, id)
      }
      if (!tab.show) return
      if (tab.worktree === selection) return deps.select(id)
      return deps.focusManaged(tab.worktree, id)
    }
    const active = deps.activePending()
    deps.placeLocal(id, tab.replace, tab.replace ? active : (active ?? deps.current()))
    persist(origin.project, id)
    if (!tab.show) return
    if (!tab.replace) deps.setActivePending(undefined)
    deps.setSelection(LOCAL)
    deps.select(id)
  }

  return {
    handle,
    quiet: (id: string) => {
      const now = deps.now?.() ?? Date.now()
      const time = quiet.get(id)
      quiet.delete(id)
      for (const [key, value] of quiet) if (now - value > QUIET) quiet.delete(key)
      return time !== undefined && now - time <= QUIET
    },
  }
}
