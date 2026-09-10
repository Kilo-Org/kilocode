import { createEffect, createMemo, onCleanup } from "solid-js"
import type { SessionInfo } from "../../src/types/messages/sessions"

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
    // Read every signal eagerly so Solid tracks them as dependencies.
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
