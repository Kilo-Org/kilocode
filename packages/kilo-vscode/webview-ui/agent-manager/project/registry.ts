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
    const store = ensure(id)
    store.tabs.set([...new Set([...legacy.tabs.ids(), ...store.tabs.ids()])])
    stores.delete("single")
  }

  const ensure = (id: string): ProjectStore => {
    let store = stores.get(id)
    if (!store) {
      const persisted =
        opts.persisted.localTabs?.[id] ??
        (id === "single" && !opts.persisted.localTabs ? opts.persisted.localSessionIDs : undefined)
      store = createProjectStore(id, { tabs: persisted })
      stores.set(id, store)
      bump((n) => n + 1)
    }
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

  // localSessionIDs is only a compatibility mirror when project buckets exist.
  if (opts.persisted.localTabs?.single?.length || (!opts.persisted.localTabs && opts.persisted.localSessionIDs?.length))
    ensure("single")

  return { ensure, active, all, prune, version, migrate }
}
