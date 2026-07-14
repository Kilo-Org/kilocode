export const PENDING_TAB_PREFIX = "sidebar-pending:"

export interface LocalTabState {
  ids: string[]
  active?: string
}

export type PendingTabCheck = (id: string) => boolean
export type ApplyLocalTabOrder = (items: { id: string }[], order: string[]) => { id: string }[]

export interface LocalTabInventory {
  local: readonly string[]
  external?: ReadonlySet<string>
}

export interface LocalTabReconcileResult {
  ids: string[]
  forget: string[]
}

export const isPendingTab = (id: string) => id.startsWith(PENDING_TAB_PREFIX)

export const showTabStrip = (ids: readonly string[]) => ids.length > 1

const unique = (ids: string[]) => [...new Set(ids.filter(Boolean))]

type PendingTabFactory = () => string

function normalize(ids: string[], active: string | undefined, pending: PendingTabFactory): LocalTabState {
  const tabs = unique(ids)
  if (tabs.length === 0) {
    const id = pending()
    return { ids: [id], active: id }
  }
  return { ids: tabs, active: active && tabs.includes(active) ? active : tabs[0] }
}

export function restoreTabs(
  ids: string[] | undefined,
  active: string | undefined,
  pending: PendingTabFactory,
  check: PendingTabCheck = isPendingTab,
): LocalTabState {
  const tabs = ids?.filter((id) => !check(id)) ?? []
  const tab = active && !check(active) ? active : undefined
  return normalize(tabs, tab, pending)
}

// New composers become active immediately even before the backend creates a session.
export function addPendingTab(state: LocalTabState, id: string): LocalTabState {
  return { ids: unique([...state.ids, id]), active: id }
}

// Existing sessions use the same state shape, but callers keep their open-or-focus intent explicit.
export function openSessionTab(state: LocalTabState, id: string): LocalTabState {
  return { ids: unique([...state.ids, id]), active: id }
}

export function insertSessionTabAfter(state: LocalTabState, source: string, id: string): LocalTabState {
  if (state.ids.includes(id)) return { ids: state.ids, active: id }
  const index = state.ids.indexOf(source)
  if (index === -1) return openSessionTab(state, id)
  const ids = [...state.ids]
  ids.splice(index + 1, 0, id)
  return { ids, active: id }
}

export function replacePendingTab(state: LocalTabState, pending: string, id: string): LocalTabState {
  if (!state.ids.includes(pending)) return state
  const ids = unique(state.ids.map((tab) => (tab === pending ? id : tab)))
  const active = state.active === pending ? id : state.active
  return { ids, active: active && ids.includes(active) ? active : ids[0] }
}

export function pendingTabForCreated(
  ids: readonly string[],
  draft: string | undefined,
  check: PendingTabCheck = isPendingTab,
): string | undefined {
  if (!draft) return undefined
  return ids.includes(draft) && check(draft) ? draft : undefined
}

export function nextTabAfterClose(ids: readonly string[], id: string): string | undefined {
  const index = ids.indexOf(id)
  if (index === -1) return undefined
  const tabs = ids.filter((tab) => tab !== id)
  return tabs[Math.min(index, tabs.length - 1)]
}

export function closeTab(state: LocalTabState, id: string, pending: PendingTabFactory): LocalTabState {
  if (!state.ids.includes(id)) return state
  const ids = state.ids.filter((tab) => tab !== id)
  if (state.active !== id) return normalize(ids, state.active, pending)
  return normalize(ids, nextTabAfterClose(state.ids, id), pending)
}

export function closeOtherTabs(state: LocalTabState, id: string): LocalTabState {
  if (!state.ids.includes(id)) return state
  return { ids: [id], active: id }
}

export function addSessionTab(state: LocalTabState, id: string): LocalTabState {
  return { ids: unique([...state.ids, id]), active: state.active }
}

export function reconcileTabs(
  state: LocalTabState,
  loaded: string[],
  pending: PendingTabFactory,
  check: PendingTabCheck = isPendingTab,
): LocalTabState {
  const seen = new Set(loaded)
  const ids = state.ids.filter((id) => check(id) || seen.has(id))
  return normalize(ids, state.active, pending)
}

export function restoreTrackedTabs(
  inventory: LocalTabInventory,
  current: string[],
  order: string[] | undefined,
  check: PendingTabCheck,
  apply: ApplyLocalTabOrder,
): string[] | undefined {
  const locals = [...inventory.local]
  const external = inventory.external
  const evict = (ids: string[]) => (external?.size ? ids.filter((id) => !external.has(id)) : ids)
  const real = current.filter((id) => !check(id))

  if (locals.length > 0 && real.length === 0) {
    if (!order) return locals
    return apply(
      locals.map((id) => ({ id })),
      order,
    ).map((item) => item.id)
  }

  const missing = locals.filter((id) => !current.includes(id))
  const base = missing.length > 0 ? [...current, ...missing] : current
  const merged = evict(base)
  const changed = missing.length > 0 || merged.length !== base.length

  if (order && merged.length > 0) {
    return apply(
      merged.map((id) => ({ id })),
      order,
    ).map((item) => item.id)
  }

  return changed ? merged : undefined
}

export function reconcileTrackedTabs(
  current: string[],
  loaded: readonly string[],
  inventory: LocalTabInventory,
  check: PendingTabCheck,
): LocalTabReconcileResult | undefined {
  const seen = new Set(loaded)
  const local = new Set(inventory.local)
  const external = inventory.external
  const ids: string[] = []
  const forget: string[] = []

  for (const id of current) {
    if (check(id)) {
      ids.push(id)
      continue
    }
    if (external?.has(id)) continue
    if (seen.has(id) || local.has(id)) {
      ids.push(id)
      continue
    }
    forget.push(id)
  }

  if (ids.length === current.length && forget.length === 0) return undefined
  return { ids, forget }
}
