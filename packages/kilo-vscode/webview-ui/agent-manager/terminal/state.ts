/**
 * Terminal tab state + event helpers for the Agent Manager webview.
 *
 * Extracted from AgentManagerApp.tsx to keep that file under the
 * `max-lines` lint cap. Owns the per-context terminal list, the
 * `activeTerminalId` focus signal, and a small set of imperative
 * helpers the main component composes with its existing tab logic.
 */

import { createMemo, createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import { LOCAL } from "../navigate"

/** Prefix used for terminal tab IDs in the webview (mirrors terminal-manager.ts). */
export const TERMINAL_PREFIX = "terminal:"

export const isTerminalTabId = (id: string): boolean => id.startsWith(TERMINAL_PREFIX)

/** One row in `terminalsByContext`. `wsUrl` is short-lived and never persisted. */
export interface TerminalTabState {
  id: string
  title: string
  wsUrl: string
}

/** Terminal row enriched with the sidebar context it belongs to. Used by
 *  the render layer so every xterm instance stays mounted across
 *  worktree switches and we only toggle visibility, not lifecycle. */
export interface TerminalTabStateWithContext extends TerminalTabState {
  contextKey: string
}

export interface TerminalCreatedEvent {
  worktreeId: string | null
  terminalId: string
  title: string
  wsUrl: string
}

export interface TerminalStateControls {
  /** Record received from `terminal.created`. */
  add(worktreeId: string | null, term: TerminalTabState): void
  /** Drop a terminal from its context (location resolved automatically). */
  remove(terminalId: string): string | undefined
  /** Resolve the context key a terminal lives in, if any. */
  contextFor(terminalId: string): string | undefined
  /** All terminals for the given sidebar selection. */
  forSelection(selection: string | null): TerminalTabStateWithContext[]
  /** Map of { id -> tab state } for O(1) lookup. */
  lookup: Accessor<Map<string, TerminalTabStateWithContext>>
  /** All terminals for the currently selected context. */
  current: Accessor<TerminalTabStateWithContext[]>
  /** Every terminal across every context (for the persistent render layer). */
  all: Accessor<TerminalTabStateWithContext[]>
  /** Context key for the current sidebar selection, or `undefined` when nothing is selected. */
  currentKey: Accessor<string | undefined>
  /** Active terminal id signal + setter. */
  activeId: Accessor<string | undefined>
  setActiveId: (id: string | undefined) => void
  /** True when the given remembered tab id points to a live terminal for the given selection. */
  hasRemembered(selection: string | null, remembered: string | undefined): boolean
  /**
   * Persist a new order for a context's terminals (webview-memory only —
   * terminals are ephemeral and never round-trip through the extension
   * host). Unknown IDs are ignored; missing IDs keep their previous
   * relative order at the end of the list.
   */
  reorder(contextKey: string, orderedIds: string[]): void
  /**
   * Apply a drag-over reorder within the current context. Returns true
   * when both ends are terminals in the current context and the move
   * was applied, false otherwise so the caller can fall through.
   */
  reorderDrag(from: string, to: string): boolean
}

/** Wire up reactive state for terminal tabs. The caller passes the current
 *  `selection()` accessor so memos can key by the right context.
 *
 *  ## Reference stability
 *
 *  Terminals are stored as `TerminalTabStateWithContext` (contextKey
 *  baked in) so the reactive accessors below can return them *by
 *  reference* without ever allocating a new object per terminal. That
 *  matters because Solid's `<For>` uses element reference equality to
 *  decide whether a child is "the same" across renders. If `all()`
 *  created `{...t, contextKey}` each time (the original bug), adding
 *  a new terminal to context A would rewrite every object in every
 *  context — `<For>` would then unmount + remount every live xterm
 *  across the whole app, destroying instances and losing canvas state.
 */
export function createTerminalState(selection: Accessor<string | null>): TerminalStateControls {
  const [terminalsByContext, setTerminalsByContext] = createSignal<Record<string, TerminalTabStateWithContext[]>>({})
  const [activeId, setActiveId] = createSignal<string | undefined>()

  const currentKey = createMemo((): string | undefined => {
    const sel = selection()
    if (sel === null) return undefined
    return sel === LOCAL ? LOCAL : sel
  })

  const current = createMemo((): TerminalTabStateWithContext[] => {
    const key = currentKey()
    if (!key) return []
    return terminalsByContext()[key] ?? []
  })

  const all = createMemo((): TerminalTabStateWithContext[] => {
    const map = terminalsByContext()
    // Concat existing per-context arrays without spreading their
    // elements, so the same record references flow through to <For>.
    const out: TerminalTabStateWithContext[] = []
    for (const list of Object.values(map)) out.push(...list)
    return out
  })

  const lookup = createMemo(() => new Map(current().map((t) => [t.id, t])))

  const contextFor = (terminalId: string): string | undefined => {
    for (const [key, terms] of Object.entries(terminalsByContext())) {
      if (terms.some((t) => t.id === terminalId)) return key
    }
    return undefined
  }

  const forSelection = (sel: string | null): TerminalTabStateWithContext[] => {
    if (sel === null) return []
    const key = sel === LOCAL ? LOCAL : sel
    return terminalsByContext()[key] ?? []
  }

  const add = (worktreeId: string | null, term: TerminalTabState) => {
    const key = worktreeId === null ? LOCAL : worktreeId
    setTerminalsByContext((prev) => {
      const list = prev[key] ?? []
      if (list.some((t) => t.id === term.id)) return prev
      const enriched: TerminalTabStateWithContext = { ...term, contextKey: key }
      return { ...prev, [key]: [...list, enriched] }
    })
  }

  const remove = (terminalId: string): string | undefined => {
    const key = contextFor(terminalId)
    if (!key) return undefined
    setTerminalsByContext((prev) => {
      const list = (prev[key] ?? []).filter((t) => t.id !== terminalId)
      const next = { ...prev }
      if (list.length === 0) delete next[key]
      else next[key] = list
      return next
    })
    return key
  }

  const hasRemembered = (sel: string | null, remembered: string | undefined): boolean => {
    if (!remembered || !isTerminalTabId(remembered)) return false
    return forSelection(sel).some((t) => t.id === remembered)
  }

  const reorder = (key: string, orderedIds: string[]) => {
    setTerminalsByContext((prev) => {
      const list = prev[key]
      if (!list || list.length === 0) return prev
      const byId = new Map(list.map((t) => [t.id, t]))
      const next: TerminalTabStateWithContext[] = []
      for (const id of orderedIds) {
        const t = byId.get(id)
        if (t) {
          next.push(t)
          byId.delete(id)
        }
      }
      // Preserve any terminals not named in the new order (fresh ones that
      // appeared between drag start and commit) at their original tail
      // position — simpler than merging and matches the existing
      // `applyTabOrder` semantics used elsewhere in the app.
      for (const t of list) if (byId.has(t.id)) next.push(t)
      if (next.length === list.length && next.every((t, i) => t.id === list[i]!.id)) return prev
      return { ...prev, [key]: next }
    })
  }

  /**
   * Reorder terminals in the current context by moving `from` to `to`'s
   * position. Returns `true` when the reorder was applied, `false` when
   * either end isn't a terminal in the current context (so the caller
   * can fall through to session / review drag logic).
   */
  const reorderDrag = (from: string, to: string): boolean => {
    const key = currentKey()
    if (!key) return false
    const order = (terminalsByContext()[key] ?? []).map((t) => t.id)
    const fi = order.indexOf(from)
    const ti = order.indexOf(to)
    if (fi === -1 || ti === -1 || fi === ti) return false
    const next = [...order]
    next.splice(fi, 1)
    next.splice(ti, 0, from)
    reorder(key, next)
    return true
  }

  return {
    add,
    remove,
    contextFor,
    forSelection,
    lookup,
    current,
    all,
    currentKey,
    activeId,
    setActiveId,
    hasRemembered,
    reorder,
    reorderDrag,
  }
}

export interface TerminalHandlerDeps {
  state: TerminalStateControls
  tabIds: Accessor<string[]>
  selectReview: () => void
  selectSessionTab: (id: string, pending: boolean) => void
  clearSession: () => void
  /** Reset review/pending state when activating a terminal. */
  resetOthers: () => void
  isPendingId: (id: string) => boolean
  /** Locate a session/pending tab by id. */
  findTab: (id: string) => { id: string } | undefined
  postMessage: (msg: unknown) => void
  /** Resolve the current sidebar selection for the new-terminal helper. */
  getSelection: () => string | null
  /** Sentinel value for the LOCAL sidebar selection. */
  LOCAL: string
  REVIEW_TAB_ID: string
}

/**
 * Build the close-terminal handler the main component wires to the
 * close button. Picks the next visible tab before dropping the entry
 * so focus flows naturally; notifies the extension last.
 */
export function createTerminalHandlers(deps: TerminalHandlerDeps) {
  const activate = (id: string) => {
    deps.state.setActiveId(id)
    deps.resetOthers()
  }

  const deactivate = () => {
    if (deps.state.activeId()) deps.state.setActiveId(undefined)
  }

  const requestNew = () => {
    const sel = deps.getSelection()
    if (sel === null) return
    deps.postMessage({ type: "agentManager.terminal.create", worktreeId: sel === deps.LOCAL ? null : sel })
  }

  const closeTerminal = (terminalId: string) => {
    const ids = deps.tabIds()
    const idx = ids.indexOf(terminalId)
    // Pick the tab to focus after closing: prefer the next tab, fall
    // back to the previous one when we just closed the rightmost tab,
    // or keep focus unset if this was the only tab in the bar.
    const nextId = ((): string | undefined => {
      if (idx < 0) return undefined
      const hasNext = idx + 1 < ids.length
      if (hasNext) return ids[idx + 1]
      const hasPrev = idx > 0
      if (hasPrev) return ids[idx - 1]
      return undefined
    })()
    const wasActive = deps.state.activeId() === terminalId
    deps.state.remove(terminalId)
    if (wasActive) {
      deps.state.setActiveId(undefined)
      if (nextId) {
        if (isTerminalTabId(nextId)) activate(nextId)
        else if (nextId === deps.REVIEW_TAB_ID) deps.selectReview()
        else {
          const target = deps.findTab(nextId)
          if (target) deps.selectSessionTab(target.id, deps.isPendingId(target.id))
        }
      } else {
        deps.clearSession()
      }
    }
    deps.postMessage({ type: "agentManager.terminal.close", terminalId })
  }

  const middleClick = (terminalId: string, e: MouseEvent) => {
    if (e.button !== 1) return
    e.preventDefault()
    e.stopPropagation()
    closeTerminal(terminalId)
  }

  const closeActive = () => {
    const id = deps.state.activeId()
    if (!id) return false
    closeTerminal(id)
    return true
  }

  return { closeTerminal, middleClick, activate, deactivate, requestNew, closeActive }
}

export interface TerminalMessageHandlerDeps {
  state: TerminalStateControls
  activate: (id: string) => void
  saveTabMemory: () => void
  setSelection: (sel: string | typeof LOCAL) => void
  showError: (message: string) => void
  /**
   * Called with the context key ("local" or worktree id) and the new
   * terminal id once a `terminal.created` message lands. The main
   * component uses this hook to append the id to its per-context tab
   * order so the terminal renders at the end of the tab bar rather
   * than wherever `tabIds()`'s base composition happens to put it.
   */
  onCreated?: (contextKey: string, terminalId: string) => void
}

/**
 * Wire handlers for the three inbound terminal messages. Returns a
 * dispatcher that accepts each message type and returns true if it
 * handled the payload. Keeps all the terminal-specific routing logic
 * out of the main webview component.
 */
export function createTerminalMessageHandler(deps: TerminalMessageHandlerDeps) {
  return (msg: { type: string } & Record<string, unknown>): boolean => {
    if (msg.type === "agentManager.terminal.created") {
      const ev = msg as unknown as TerminalCreatedEvent
      const contextKey = ev.worktreeId === null ? LOCAL : ev.worktreeId
      deps.state.add(ev.worktreeId, { id: ev.terminalId, title: ev.title, wsUrl: ev.wsUrl })
      deps.onCreated?.(contextKey, ev.terminalId)
      deps.saveTabMemory()
      deps.setSelection(contextKey)
      deps.activate(ev.terminalId)
      return true
    }
    if (msg.type === "agentManager.terminal.closed") {
      const ev = msg as unknown as { terminalId: string }
      deps.state.remove(ev.terminalId)
      if (deps.state.activeId() === ev.terminalId) deps.state.setActiveId(undefined)
      return true
    }
    if (msg.type === "agentManager.terminal.error") {
      const ev = msg as unknown as { message: string }
      deps.showError(ev.message)
      return true
    }
    return false
  }
}
