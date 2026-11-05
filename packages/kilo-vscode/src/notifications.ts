// Dismissed Gateway notification IDs for every open view. The webview keeps its own optimistic copy; this store
// makes the host read-modify-write atomic, because Close dismisses several IDs in one loop and each message would
// otherwise read globalState before the previous write lands.
const KEY = "kilo-code.v2.dismissedNotificationIds"

const cache = new WeakMap<object, string[]>()
const writes = new WeakMap<object, PromiseLike<unknown>>()

export interface NotificationStore {
  readonly globalState: {
    get<T>(key: string, defaultValue: T): T
    update(key: string, value: string[]): PromiseLike<void>
  }
}

function state(store: NotificationStore) {
  return store.globalState
}

function current(store: NotificationStore) {
  const stored = store.globalState.get<string[]>(KEY, [])
  const known = cache.get(state(store)) ?? []
  // Merge the cached IDs with the stored ones: another VS Code window shares globalState, and its dismissals
  // must not disappear when this window writes next.
  const ids = [...known]
  for (const id of Array.isArray(stored) ? stored : []) if (!ids.includes(id)) ids.push(id)
  cache.set(state(store), ids)
  return ids
}

function save(store: NotificationStore, ids: string[]) {
  cache.set(state(store), ids)
  const previous = writes.get(state(store)) ?? Promise.resolve()
  const next = Promise.resolve(previous).then(() => store.globalState.update(KEY, ids))
  const settled = next.then(
    () => undefined,
    () => undefined,
  )
  writes.set(state(store), settled)
  return settled
}

/** The IDs this window dismissed, shared by every view. */
export function dismissedNotifications(store: NotificationStore): string[] {
  return current(store)
}

/** Adds one ID once, so a repeated dismiss of the same notice is idempotent. */
export function dismissNotification(store: NotificationStore, id: string): string[] {
  const ids = current(store)
  if (ids.includes(id)) return ids
  const next = [...ids, id]
  void save(store, next)
  return next
}

/** Keeps only the dismissed IDs the Gateway still sends, so a removed notice can appear again. */
export function syncDismissedNotifications(store: NotificationStore, activeIds: readonly string[]): string[] {
  const ids = current(store)
  // The Gateway also returns an empty list when signed out or when the request failed, so an empty response must
  // never erase the dismissed set.
  if (activeIds.length === 0) return ids
  const active = new Set(activeIds)
  const next = ids.filter((id) => active.has(id))
  if (next.length === ids.length) return ids
  void save(store, next)
  return next
}
