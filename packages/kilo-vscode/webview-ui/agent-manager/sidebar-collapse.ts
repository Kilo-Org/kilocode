import { createSignal } from "solid-js"
import type { WebviewMessage } from "../src/types/messages"

export interface VsCodePoster {
  postMessage: (msg: WebviewMessage) => void
}

interface Options {
  initial?: boolean
  persist?: (collapsed: boolean) => void
}

/**
 * Encapsulates the sidebar collapsed signal, persistence postMessage, and
 * a single-frame "hydrated" flag that gates the width transition so the
 * initial render (after restart with a persisted-collapsed state) does not
 * animate from open to closed.
 */
export function createSidebarCollapse(vscode: VsCodePoster, opts: Options = {}) {
  const [collapsed, setCollapsed] = createSignal(opts.initial ?? false)
  const [hydrated, setHydrated] = createSignal(false)

  const persist = (next: boolean) => {
    setCollapsed(next)
    opts.persist?.(next)
    vscode.postMessage({ type: "agentManager.setSidebarCollapsed", collapsed: next })
  }

  return {
    collapsed,
    hydrated,
    /** Apply state from extension push without re-broadcasting. */
    hydrate: (value?: boolean) => {
      if (value !== undefined) setCollapsed(value)
      if (!hydrated()) requestAnimationFrame(() => setHydrated(true))
    },
    /** Ensure the sidebar is visible; no-op + no message when already open. */
    expand: () => {
      if (collapsed()) persist(false)
    },
    /** Toggle and persist. */
    toggle: () => persist(!collapsed()),
  }
}
