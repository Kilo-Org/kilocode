import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { SessionInfo } from "../src/types/messages/sessions"

const EMPTY: string[] = []

export interface PersistedLocalTabs {
  /** Legacy single-project list, migrated into the "single" bucket. */
  localSessionIDs?: string[]
  localTabs?: Record<string, string[]>
}

/**
 * Open LOCAL session tabs, bucketed per project.
 *
 * Every project uses the same LOCAL context, so one shared list would surface
 * the sessions opened in one project under every other project after a switch.
 * Keying by project keeps each project's open tabs to itself while the accessor
 * and setter behave like a plain signal for the active project.
 */
export function createLocalTabs(persisted: PersistedLocalTabs | undefined, key: () => string) {
  const [tabs, setTabs] = createSignal<Record<string, string[]>>(
    persisted?.localTabs ?? (persisted?.localSessionIDs?.length ? { single: persisted.localSessionIDs } : {}),
  )
  const ids = () => tabs()[key()] ?? EMPTY
  const set = (next: string[] | ((prev: string[]) => string[])) =>
    setTabs((prev) => {
      const bucket = key()
      const cur = prev[bucket] ?? EMPTY
      const value = typeof next === "function" ? next(cur) : next
      return value === cur ? prev : { ...prev, [bucket]: value }
    })
  /** All buckets with ephemeral tabs removed, ready to persist. */
  const durable = (pending: (id: string) => boolean) =>
    Object.fromEntries(Object.entries(tabs()).map(([bucket, list]) => [bucket, list.filter((id) => !pending(id))]))
  return { ids, set, durable }
}

/**
 * Persist open tabs and the sidebar width to webview state for recovery.
 * Debounced so a resize drag does not serialize state on every pixel.
 */
export function persistLocalTabs(opts: {
  tabs: () => Record<string, string[]>
  key: () => string
  width: () => number
  get: () => Record<string, unknown> | undefined
  set: (value: Record<string, unknown>) => void
}): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    // Read every signal eagerly so Solid tracks them as dependencies.
    const tabs = opts.tabs()
    const key = opts.key()
    const width = opts.width()
    clearTimeout(timer)
    timer = setTimeout(() => {
      opts.set({ ...(opts.get() ?? {}), localTabs: tabs, localSessionIDs: tabs[key] ?? [], sidebarWidth: width })
    }, 300)
  })
  onCleanup(() => clearTimeout(timer))
}

/** Local sessions resolved from the session store plus pending tabs, in insertion order. */
export function createLocalSessions(opts: {
  ids: () => string[]
  sessions: () => SessionInfo[]
  pending: (id: string) => boolean
  root: (s: SessionInfo) => boolean
  title: () => string
}) {
  return createMemo((): SessionInfo[] => {
    const lookup = new Map(opts.sessions().map((s) => [s.id, s]))
    const result: SessionInfo[] = []
    const now = new Date().toISOString()
    for (const id of opts.ids()) {
      const real = lookup.get(id)
      if (real && opts.root(real)) {
        result.push(real)
        continue
      }
      if (opts.pending(id)) result.push({ id, title: opts.title(), createdAt: now, updatedAt: now })
    }
    return result
  })
}
