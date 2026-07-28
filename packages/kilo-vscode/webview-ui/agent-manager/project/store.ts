import { createSignal } from "solid-js"

/** Local session tab ids owned by one project. */
export function createStoreTabs(initial: string[] = []) {
  const [ids, setIds] = createSignal<string[]>(initial)
  const set = (next: string[] | ((prev: string[]) => string[])) => {
    const cur = ids()
    const value = typeof next === "function" ? next(cur) : next
    if (value !== cur) setIds(value)
  }
  /** Ids safe to persist (ephemeral pending drafts removed). */
  const durable = (pending: (id: string) => boolean) => ids().filter((id) => !pending(id))
  return { ids, set, durable }
}

/**
 * Per-project UI state that must never be shared with other projects.
 * Currently: local session tabs and the remembered tab per sidebar context.
 */
export function createProjectStore(id: string, opts: { tabs?: string[] } = {}) {
  const tabs = createStoreTabs(opts.tabs)

  /** Last visible tab per sidebar context ("local" or a worktree id). */
  const [memory, setMemory] = createSignal<Record<string, string>>({})
  const tabMemory = {
    all: memory,
    get: (sel: string) => memory()[sel],
    set: (sel: string, tab: string) => setMemory((prev) => (prev[sel] === tab ? prev : { ...prev, [sel]: tab })),
  }

  return { id, tabs, tabMemory }
}

export type ProjectStore = ReturnType<typeof createProjectStore>
