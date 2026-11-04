import { createEffect, createMemo, onCleanup } from "solid-js"
import type { ProjectSessionInfo, SessionInfo } from "../../src/types/messages/agent-manager"
import type { AgentManagerStateMessage } from "../../src/types/messages/agent-manager"

/** A session the panel shows in a tab before the server lists it. */
function draft(id: string, title: string, directory: string): SessionInfo {
  const now = Date.now()
  return {
    id,
    projectID: "",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: now, updated: now },
    title,
    location: { directory },
  }
}

/**
 * Persist open tabs and panel widths to webview state for recovery.
 * Debounced so a resize drag does not serialize state on every pixel.
 */
export function persistLocalTabs(opts: {
  tabs: () => Record<string, string[]>
  key: () => string
  width: () => number
  panelWidth?: () => number
  get: () => Record<string, unknown> | undefined
  set: (value: Record<string, unknown>) => void
}): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const tabs = opts.tabs()
    const key = opts.key()
    const width = opts.width()
    const panel = opts.panelWidth?.()
    clearTimeout(timer)
    timer = setTimeout(() => {
      opts.set({
        ...(opts.get() ?? {}),
        localTabs: tabs,
        localSessionIDs: tabs[key] ?? [],
        sidebarWidth: width,
        ...(panel === undefined ? {} : { sidePanelWidth: panel }),
      })
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
  directory: () => string
}) {
  return createMemo((): SessionInfo[] => {
    const lookup = new Map(opts.sessions().map((s) => [s.id, s]))
    const result: SessionInfo[] = []
    for (const id of opts.ids()) {
      const real = lookup.get(id)
      if (real && opts.root(real)) {
        result.push(real)
        continue
      }
      if (opts.pending(id)) result.push(draft(id, opts.title(), opts.directory()))
    }
    return result
  })
}

export function projectLocalIds(state: AgentManagerStateMessage | undefined): string[] {
  return state?.sessions.filter((item) => item.worktreeId === null).map((item) => item.id) ?? []
}

export function projectLocalSessions(
  live: ProjectSessionInfo[],
  ids: string[],
  isPending: (id: string) => boolean,
  directory = "",
): ProjectSessionInfo[] {
  const now = Date.now()
  const known = new Map(live.filter((item) => item.worktreeId === null).map((item) => [item.id, item] as const))
  for (const id of ids) {
    if (isPending(id) || known.has(id)) continue
    known.set(id, {
      id,
      projectID: "",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: now, updated: now },
      location: { directory },
      worktreeId: null,
    })
  }
  return [...known.values()]
}