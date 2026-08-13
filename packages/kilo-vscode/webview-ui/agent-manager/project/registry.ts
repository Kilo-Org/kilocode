import { createSignal } from "solid-js"
import { createProjectStore, type ProjectStore } from "./store"

export interface PersistedProjectTabs {
  /** Buckets keyed by project id, as persisted by persistLocalTabs. */
  localTabs?: Record<string, string[]>
  /** Legacy single-project list from before per-project buckets existed. */
  localSessionIDs?: string[]
}

/**
 * Registry of per-project stores. Exactly one store is "active" at a time —
 * the project whose state is currently applied — and every per-project
 * accessor in the app goes through it, replacing the memKey/tabKey keying
 * that mixed catalog-active and applied-project identities.
 */
export function createProjectRegistry(opts: { persisted: PersistedProjectTabs; activeId: () => string }) {
  const stores = new Map<string, ProjectStore>()
  // Bumped whenever a store is created so effects depending on the registry
  // contents re-run (the Map itself is not reactive).
  const [version, bump] = createSignal(0)

  const migrate = (id: string): void => {
    if (id === "single") return
    const legacy = stores.get("single")
    if (!legacy) return
    if (legacy.tabs.ids().length === 0) {
      stores.delete("single")
      return
    }
    // Only consume the legacy bucket when its tabs actually moved; a project
    // that already has its own tabs must not swallow them silently.
    const store = stores.get(id)
    if (!store || store.tabs.ids().length > 0) return
    store.tabs.set(legacy.tabs.ids())
    stores.delete("single")
  }

  const ensure = (id: string): ProjectStore => {
    let store = stores.get(id)
    if (!store) {
      const persisted = opts.persisted.localTabs?.[id] ?? (id === "single" ? opts.persisted.localSessionIDs : undefined)
      store = createProjectStore(id, { tabs: persisted })
      stores.set(id, store)
      bump((n) => n + 1)
    }
    migrate(id)
    return store
  }

  /** The store of the project whose state is currently applied. */
  const active = (): ProjectStore => ensure(opts.activeId())
  const all = (): ProjectStore[] => [...stores.values()]

  /** Drop stores for projects that left the catalog (keeps "single" for legacy). */
  const prune = (ids: Set<string>): void => {
    for (const id of [...stores.keys()]) {
      if (id === "single") continue
      if (!ids.has(id)) stores.delete(id)
    }
  }

  // Materialize the legacy bucket eagerly so migration works regardless of
  // which project is ensured first.
  if (opts.persisted.localSessionIDs?.length) ensure("single")

  return { ensure, active, all, prune, version }
}
