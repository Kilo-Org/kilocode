/**
 * Where a session that a chat view created, or sent a prompt to, lands in the tab bar, and whether it takes the view.
 * A send is bound to the tab it was pressed in. A first send can wait for the sandbox default or a revert, and the
 * user can move to another tab or context meanwhile: the session then fills the draft tab it came from and the view
 * stays where the user is, as v1 did.
 */
import { openSessionTab, replacePendingTab } from "../src/utils/local-tabs"
import { LOCAL } from "./navigate"
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
