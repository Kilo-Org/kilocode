/**
 * Terminal tab state + event helpers for the Agent Manager webview.
 *
 * Extracted from AgentManagerApp.tsx to keep that file under the
 * `max-lines` lint cap. Owns the per-context terminal list, the
 * `activeTerminalId` focus signal, and a small set of imperative
 * helpers the main component composes with its existing tab logic.
 *
 * Main terminal tabs and right-side terminals share the same PTY
 * transport, but their UI state is intentionally separate: tab
 * activation replaces the chat, while a side terminal lives in the
 * right-hand inspector and keeps the current session visible.
 */

import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import { LOCAL } from "../navigate"
import type {
  ExtensionMessage,
  ScriptTerminalKind,
  ScriptTerminalView,
} from "../../src/types/messages/extension-messages"
import type { TerminalDestination, TerminalFont, TerminalPlacement } from "../../src/types/messages/agent-manager"

export type { TerminalFont }

/** Prefix used for terminal tab IDs in the webview (mirrors terminal-manager.ts). */
export const TERMINAL_PREFIX = "terminal:"
export const SCRIPT_TERMINAL_PREFIX = "script:"

export const isTerminalTabId = (id: string): boolean =>
  id.startsWith(TERMINAL_PREFIX) || id.startsWith(SCRIPT_TERMINAL_PREFIX)

/** Status is separate from mounted xterm records so snapshot updates never remount them. */
export type ScriptTerminalStatus = Pick<ScriptTerminalView, "state" | "exitCode" | "kind">

/** One row in `terminalsByContext`. `wsUrl` is short-lived and never persisted. */
export interface TerminalTabState {
  id: string
  title: string
  wsUrl: string
  font: TerminalFont
  placement: TerminalPlacement
  /** Provider-owned script terminal, never created through the webview create flow. */
  kind?: ScriptTerminalKind
}

/** Terminal row enriched with the sidebar context it belongs to. Used by
 *  the render layer so every xterm instance stays mounted across
 *  worktree switches and we only toggle visibility, not lifecycle. */
export interface TerminalTabStateWithContext extends TerminalTabState {
  contextKey: string
}

/** Explicit focus demand, consumed by `TerminalTab` via the render layer.
 *  The serial lets repeated requests for the same terminal retrigger the
 *  focus effect. */
export interface TerminalFocusRequest {
  id: string
  serial: number
}

/** A create request for a side terminal that has not been answered yet.
 *  Multiple creates can be in flight for the same context at once. */
interface SideRequest {
  contextKey: string
  focus: boolean
}

export interface TerminalStateControls {
  /** Record received from `terminal.created`. */
  add(worktreeId: string | null, term: TerminalTabState): void
  /** Drop a terminal from its context (location resolved automatically).
   *  Returns the removed record so callers can react to placement. */
  remove(terminalId: string): TerminalTabStateWithContext | undefined
  /** Resolve the context key a terminal lives in, if any. */
  contextFor(terminalId: string): string | undefined
  /** Whether a terminal belongs to a provider-owned script (Run/Setup). */
  isScript(terminalId: string): boolean
  /** Reactive script state, kept apart from stable xterm terminal records. */
  scriptStatus(terminalId: string): ScriptTerminalStatus | undefined
  /** Reconcile a complete provider-owned script terminal snapshot. Returns newly hydrated records. */
  syncScripts(views: ScriptTerminalView[]): TerminalTabStateWithContext[]
  /** All tab terminals for the given sidebar selection. */
  forSelection(selection: string | null): TerminalTabStateWithContext[]
  /** Map of { id -> tab state } for O(1) lookup. */
  lookup: Accessor<Map<string, TerminalTabStateWithContext>>
  /** All tab terminals for the currently selected context. */
  current: Accessor<TerminalTabStateWithContext[]>
  /** Every tab terminal across every context (for the persistent render layer). */
  all: Accessor<TerminalTabStateWithContext[]>
  /** Every side terminal across every context (for the side-panel layer). */
  sides: Accessor<TerminalTabStateWithContext[]>
  /** Every side terminal of the given context, in creation order. */
  sidesForContext(contextKey: string): TerminalTabStateWithContext[]
  /** Id of the active side terminal for a context. */
  sideActiveFor(contextKey: string): string | undefined
  /** Mark a side terminal as the visible one for its context. */
  setSideActive(contextKey: string, terminalId: string): void
  /** Id of the side terminal holding DOM focus in the current context, if any. */
  sideFocusedId(): string | undefined
  /** Context key for the current sidebar selection, or `undefined` when nothing is selected. */
  currentKey: Accessor<string | undefined>
  /** Context key for the side panel: like `currentKey` but unassigned
   *  sessions (null selection) share the LOCAL workspace-root terminal. */
  sideKey: Accessor<string>
  /** Active terminal id signal + setter. */
  activeId: Accessor<string | undefined>
  setActiveId: (id: string | undefined) => void
  /** The terminal that currently holds DOM focus, if any. Set by
   *  `TerminalTab` focus listeners; drives `Cmd+W` targeting. */
  focusedId: Accessor<string | undefined>
  setFocusedId: (id: string | undefined) => void
  /** Latest explicit focus demand. */
  focusRequest: Accessor<TerminalFocusRequest | undefined>
  requestFocus(id: string): void
  /** True when the given remembered tab id points to a live terminal for the given selection. */
  hasRemembered(selection: string | null, remembered: string | undefined): boolean
  /** Live display title for a terminal: the OSC-provided title when the
   *  shell/program set one, otherwise the create-time title. */
  title(terminalId: string): string | undefined
  /** Record an OSC title change for a terminal. Kept outside the
   *  terminal records so `<For>` reference stability (and therefore the
   *  mounted xterm instances) is preserved. */
  setTitle(terminalId: string, title: string): void
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
  /**
   * Apply a drag-over reorder within a context's side terminals (the
   * side-panel strip). Returns true when both ends are side terminals
   * of that context.
   */
  reorderSideDrag(contextKey: string, from: string, to: string): boolean
  /** Request ids of the in-flight side-terminal creates for a context. */
  pendingSide(contextKey: string): boolean
  /** Mark a side-terminal create as in flight for a context. */
  beginSide(contextKey: string, createId: string, focus?: boolean): void
  /** Settle a create request; returns it so the caller can validate. */
  completeSide(createId: string): SideRequest | undefined
}

/** Wire up reactive state for terminal tabs. The caller passes the current
 *  `selection()` accessor so the accessors below key by the right context.
 *
 *  ## Reference stability
 *
 *  Terminals are stored as `TerminalTabStateWithContext` (contextKey
 *  baked in) so the accessors below can return them *by reference*
 *  without ever allocating a new object per terminal. That matters
 *  because Solid's `<For>` uses element reference equality to decide
 *  whether a child is "the same" across renders. If `all()` created
 *  `{...t, contextKey}` each time (the original bug), adding a new
 *  terminal to context A would rewrite every object in every context —
 *  `<For>` would then unmount + remount every live xterm across the
 *  whole app, destroying instances and losing canvas state.
 *
 *  ## Plain accessors, not memos
 *
 *  The derived accessors are plain functions rather than `createMemo`.
 *  Signal reads inside them are still tracked by whatever computation
 *  calls them, and `<For>` identity comes from the stored records above
 *  (not from the array), so behavior is identical — while the module
 *  stays unit-testable: bun resolves `solid-js` to its server build,
 *  where a memo never recomputes after a signal write. Re-filtering a
 *  handful of terminals per read is far cheaper than an xterm frame.
 */
export function createTerminalState(selection: Accessor<string | null>): TerminalStateControls {
  const [terminalsByContext, setTerminalsByContext] = createSignal<Record<string, TerminalTabStateWithContext[]>>({})
  const [activeId, setActiveId] = createSignal<string | undefined>()
  const [focusedId, setFocusedId] = createSignal<string | undefined>()
  const [focusRequest, setFocusRequest] = createSignal<TerminalFocusRequest | undefined>()
  // OSC-provided titles, keyed by terminal id. Separate from the terminal
  // records on purpose: replacing a record would remount its xterm via
  // <For> reference inequality (see the module comment above).
  const [titles, setTitles] = createSignal<Record<string, string>>({})
  const [scripts, setScripts] = createSignal<Record<string, ScriptTerminalStatus>>({})
  // Active side terminal per context.
  const [actives, setActives] = createSignal<Record<string, string>>({})
  let focusSerial = 0
  // In-flight side-terminal creates, keyed both ways: per context (what
  // the panel shows) and per request id (what the answer carries). A
  // context can have several creates in flight at once.
  const [pending, setPending] = createSignal<Record<string, string[]>>({})
  const requests = new Map<string, SideRequest>()

  const currentKey = (): string | undefined => {
    const sel = selection()
    if (sel === null) return undefined
    return sel === LOCAL ? LOCAL : sel
  }

  const sideKey = (): string => {
    const sel = selection()
    if (sel === null || sel === LOCAL) return LOCAL
    return sel
  }

  const current = (): TerminalTabStateWithContext[] => {
    const key = currentKey()
    if (!key) return []
    return (terminalsByContext()[key] ?? []).filter((t) => t.placement === "tab")
  }

  const all = (): TerminalTabStateWithContext[] => {
    const map = terminalsByContext()
    // Concat existing per-context arrays without spreading their
    // elements, so the same record references flow through to <For>.
    const out: TerminalTabStateWithContext[] = []
    for (const list of Object.values(map)) {
      for (const t of list) if (t.placement === "tab") out.push(t)
    }
    return out
  }

  const sides = (): TerminalTabStateWithContext[] => {
    const map = terminalsByContext()
    // Same reference-stability rule as `all` — the side render layer is
    // a <For> over live xterm instances too.
    const out: TerminalTabStateWithContext[] = []
    for (const list of Object.values(map)) {
      for (const t of list) if (t.placement === "side") out.push(t)
    }
    return out
  }

  const sidesForContext = (key: string) => (terminalsByContext()[key] ?? []).filter((t) => t.placement === "side")
  const sideActiveFor = (key: string) => actives()[key]
  const sideFocusedId = () => {
    const id = focusedId()
    if (!id) return undefined
    return sidesForContext(sideKey()).some((t) => t.id === id) ? id : undefined
  }

  const setSideActive = (key: string, terminalId: string) => {
    setActives((prev) => (prev[key] === terminalId ? prev : { ...prev, [key]: terminalId }))
  }

  const title = (terminalId: string): string | undefined => {
    const key = contextFor(terminalId)
    if (!key) return undefined
    const term = terminalsByContext()[key]?.find((t) => t.id === terminalId)
    if (!term) return undefined
    // Script terminals always retain their semantic title, even when their
    // command emits OSC title sequences.
    if (term.kind) return term.title
    return titles()[terminalId] ?? term.title
  }

  const setTitle = (terminalId: string, next: string) => {
    if (isScript(terminalId)) return
    const trimmed = next.trim()
    if (!trimmed) return
    setTitles((prev) => (prev[terminalId] === trimmed ? prev : { ...prev, [terminalId]: trimmed }))
  }

  const lookup = () => new Map(current().map((t) => [t.id, t]))

  const contextFor = (terminalId: string): string | undefined => {
    for (const [key, terms] of Object.entries(terminalsByContext())) {
      if (terms.some((t) => t.id === terminalId)) return key
    }
    return undefined
  }

  const isScript = (terminalId: string): boolean => {
    const key = contextFor(terminalId)
    return terminalsByContext()[key ?? ""]?.some((term) => term.id === terminalId && term.kind !== undefined) ?? false
  }

  const scriptStatus = (terminalId: string): ScriptTerminalStatus | undefined => {
    if (!isScript(terminalId)) return undefined
    return scripts()[terminalId]
  }

  const forSelection = (sel: string | null): TerminalTabStateWithContext[] => {
    if (sel === null) return []
    const key = sel === LOCAL ? LOCAL : sel
    return (terminalsByContext()[key] ?? []).filter((t) => t.placement === "tab")
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

  const remove = (terminalId: string): TerminalTabStateWithContext | undefined => {
    const key = contextFor(terminalId)
    if (!key) return undefined
    const removed = terminalsByContext()[key]?.find((t) => t.id === terminalId)
    setTerminalsByContext((prev) => {
      const list = (prev[key] ?? []).filter((t) => t.id !== terminalId)
      const next = { ...prev }
      if (list.length === 0) delete next[key]
      else next[key] = list
      return next
    })
    if (focusedId() === terminalId) setFocusedId(undefined)
    // A removed active side terminal hands activation to the last
    // remaining one of its context, so the panel never shows a dead slot.
    if (removed?.placement === "side" && actives()[key] === terminalId) {
      const rest = sidesForContext(key)
      setActives((prev) => {
        const next = { ...prev }
        if (rest.length === 0) delete next[key]
        else next[key] = rest[rest.length - 1]!.id
        return next
      })
    }
    if (titles()[terminalId] !== undefined) {
      setTitles((prev) => {
        const next = { ...prev }
        delete next[terminalId]
        return next
      })
    }
    if (removed?.kind && scripts()[terminalId] !== undefined) {
      setScripts((prev) => {
        const next = { ...prev }
        delete next[terminalId]
        return next
      })
    }
    return removed
  }

  const syncScripts = (views: ScriptTerminalView[]): TerminalTabStateWithContext[] => {
    const ids = new Set(views.map((view) => view.terminalId))
    const added: TerminalTabStateWithContext[] = []
    const removed: TerminalTabStateWithContext[] = []

    setTerminalsByContext((prev) => {
      let changed = false
      const next: Record<string, TerminalTabStateWithContext[]> = {}
      for (const [key, list] of Object.entries(prev)) {
        const kept = list.filter((term) => {
          if (term.kind === undefined || ids.has(term.id)) return true
          removed.push(term)
          changed = true
          return false
        })
        if (kept.length > 0) next[key] = kept
      }
      for (const view of views) {
        const target = view.worktreeId ?? LOCAL
        const key = view.projectId ? `${view.projectId}:${target}` : target
        const list = next[key] ?? []
        if (list.some((term) => term.id === view.terminalId)) continue
        const term: TerminalTabStateWithContext = {
          id: view.terminalId,
          title: view.title,
          wsUrl: view.wsUrl,
          font: view.font,
          placement: "side",
          kind: view.kind,
          contextKey: key,
        }
        next[key] = [...list, term]
        added.push(term)
        changed = true
      }
      return changed ? next : prev
    })

    const states: Record<string, ScriptTerminalStatus> = {}
    for (const view of views) {
      const status: ScriptTerminalStatus = { state: view.state, kind: view.kind }
      if (view.exitCode !== undefined) status.exitCode = view.exitCode
      states[view.terminalId] = status
    }
    setScripts((prev) => {
      const keys = Object.keys(states)
      if (keys.length !== Object.keys(prev).length) return states
      for (const id of keys) {
        const before = prev[id]
        const after = states[id]
        if (before?.state !== after?.state || before?.exitCode !== after?.exitCode || before?.kind !== after?.kind)
          return states
      }
      return prev
    })

    if (added.length > 0) {
      setActives((prev) => {
        let changed = false
        const next = { ...prev }
        for (const term of added) {
          if (next[term.contextKey]) continue
          next[term.contextKey] = term.id
          changed = true
        }
        return changed ? next : prev
      })
    }

    if (removed.length > 0) {
      const removedIds = new Set(removed.map((term) => term.id))
      if (focusedId() && removedIds.has(focusedId()!)) setFocusedId(undefined)
      if (activeId() && removedIds.has(activeId()!)) setActiveId(undefined)
      setTitles((prev) => {
        const next = { ...prev }
        for (const id of removedIds) delete next[id]
        return next
      })
      setActives((prev) => {
        let changed = false
        const next = { ...prev }
        for (const key of new Set(removed.map((term) => term.contextKey))) {
          if (!prev[key] || !removedIds.has(prev[key]!)) continue
          const rest = sidesForContext(key)
          if (rest.length === 0) delete next[key]
          else next[key] = rest[rest.length - 1]!.id
          changed = true
        }
        return changed ? next : prev
      })
    }
    return added
  }

  const requestFocus = (id: string) => {
    focusSerial++
    setFocusRequest({ id, serial: focusSerial })
  }

  const hasRemembered = (sel: string | null, remembered: string | undefined): boolean => {
    if (!remembered || !isTerminalTabId(remembered)) return false
    return forSelection(sel).some((t) => t.id === remembered)
  }

  const reorder = (key: string, orderedIds: string[]) => {
    setTerminalsByContext((prev) => {
      const list = prev[key]
      if (!list || list.length === 0) return prev
      // Tab order only covers tab terminals; side terminals never join
      // the tab strip and keep their position at the end of the list.
      const tabs = list.filter((t) => t.placement === "tab")
      const side = list.filter((t) => t.placement === "side")
      const byId = new Map(tabs.map((t) => [t.id, t]))
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
      for (const t of tabs) if (byId.has(t.id)) next.push(t)
      const ordered = [...next, ...side]
      if (ordered.length === list.length && ordered.every((t, i) => t.id === list[i]!.id)) return prev
      return { ...prev, [key]: ordered }
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
    const order = current().map((t) => t.id)
    const fi = order.indexOf(from)
    const ti = order.indexOf(to)
    if (fi === -1 || ti === -1 || fi === ti) return false
    const next = [...order]
    next.splice(fi, 1)
    next.splice(ti, 0, from)
    reorder(key, next)
    return true
  }

  /**
   * Reorder the side terminals of a context by moving `from` to `to`'s
   * position (side-panel strip drag-and-drop). Tab terminals keep their
   * leading positions; only the side subset is reshuffled. The order
   * lives in the same `terminalsByContext` list, so it survives sidebar
   * context switches for the lifetime of the webview.
   */
  const reorderSideDrag = (key: string, from: string, to: string): boolean => {
    const order = sidesForContext(key).map((t) => t.id)
    const fi = order.indexOf(from)
    const ti = order.indexOf(to)
    if (fi === -1 || ti === -1 || fi === ti) return false
    const next = [...order]
    next.splice(fi, 1)
    next.splice(ti, 0, from)
    setTerminalsByContext((prev) => {
      const list = prev[key]
      if (!list || list.length === 0) return prev
      const tabs = list.filter((t) => t.placement === "tab")
      const sides = list.filter((t) => t.placement === "side")
      const byId = new Map(sides.map((t) => [t.id, t]))
      const moved: TerminalTabStateWithContext[] = []
      for (const id of next) {
        const t = byId.get(id)
        if (t) moved.push(t)
      }
      // Fresh terminals that appeared mid-drag keep their tail position.
      for (const t of sides) if (!moved.includes(t)) moved.push(t)
      const ordered = [...tabs, ...moved]
      if (ordered.length === list.length && ordered.every((t, i) => t.id === list[i]!.id)) return prev
      return { ...prev, [key]: ordered }
    })
    return true
  }

  const pendingSide = (key: string) => (pending()[key]?.length ?? 0) > 0

  const beginSide = (key: string, createId: string, focus = false) => {
    requests.set(createId, { contextKey: key, focus })
    setPending((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), createId] }))
  }

  const completeSide = (createId: string): SideRequest | undefined => {
    const request = requests.get(createId)
    if (!request) return undefined
    requests.delete(createId)
    setPending((prev) => {
      const list = (prev[request.contextKey] ?? []).filter((id) => id !== createId)
      if (list.length === (prev[request.contextKey]?.length ?? 0)) return prev
      const next = { ...prev }
      if (list.length === 0) delete next[request.contextKey]
      else next[request.contextKey] = list
      return next
    })
    return request
  }

  return {
    add,
    remove,
    contextFor,
    isScript,
    scriptStatus,
    syncScripts,
    forSelection,
    lookup,
    current,
    all,
    sides,
    sidesForContext,
    sideActiveFor,
    setSideActive,
    sideFocusedId,
    currentKey,
    sideKey,
    activeId,
    setActiveId,
    focusedId,
    setFocusedId,
    focusRequest,
    requestFocus,
    hasRemembered,
    title,
    setTitle,
    reorder,
    reorderDrag,
    reorderSideDrag,
    pendingSide,
    beginSide,
    completeSide,
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
  onRemove?: () => void
  /** Reveal the right-side inspector in terminal mode. */
  onShowSide: (contextKey: string) => void
  /** Resolve the current sidebar selection for the new-terminal helper. */
  getSelection: () => string | null
  /** Sentinel value for the LOCAL sidebar selection. */
  LOCAL: string
  REVIEW_TAB_ID: string
}

/** Correlation ids for terminal create requests. */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
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
    deps.postMessage({
      type: "agentManager.terminal.create",
      createId: newId(),
      placement: "tab",
      worktreeId: sel === deps.LOCAL ? null : sel,
    })
  }

  const createSide = (focus = false) => {
    const key = deps.state.sideKey()
    // The wire protocol speaks plain worktree ids; `sideKey` is the
    // project-namespaced state key and must not leak into the message.
    const sel = deps.getSelection()
    const id = newId()
    deps.state.beginSide(key, id, focus)
    deps.postMessage({
      type: "agentManager.terminal.create",
      createId: id,
      placement: "side",
      worktreeId: sel === null || sel === deps.LOCAL ? null : sel,
    })
  }

  /**
   * Always create a fresh side terminal for the current context (the
   * panel's `+` action and empty state). Multiple creates may be in
   * flight at once; each lands as its own tab in the panel strip.
   */
  const addSide = () => {
    deps.onShowSide(deps.state.sideKey())
    createSide(true)
  }

  /** Ensure the current context has a terminal without changing panel mode. */
  const ensureSide = () => {
    const key = deps.state.sideKey()
    if (deps.state.sidesForContext(key).length > 0 || deps.state.pendingSide(key)) return
    createSide()
  }

  /**
   * Reveal the side panel and focus the context's active side terminal,
   * creating one when the context has none. Never touches the tab strip
   * or the chat session.
   */
  const requestSide = () => {
    const key = deps.state.sideKey()
    deps.onShowSide(key)
    const existing = deps.state.sidesForContext(key)
    if (existing.length > 0) {
      const active = deps.state.sideActiveFor(key) ?? existing[existing.length - 1]!.id
      deps.state.setSideActive(key, active)
      deps.state.requestFocus(active)
      return
    }
    if (deps.state.pendingSide(key)) return
    createSide(true)
  }

  const closeTerminal = (terminalId: string) => {
    // Script terminals transition through a provider-owned stopping snapshot.
    // Keep their xterm mounted until closure is confirmed by a snapshot or
    // terminal.closed message so live output is never discarded early.
    if (deps.state.isScript(terminalId)) {
      deps.postMessage({ type: "agentManager.terminal.close", terminalId })
      return
    }
    deps.onRemove?.()
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

  /**
   * Kill one side terminal. The panel stays open on the remaining
   * terminals (or the empty state when this was the last one) — hiding
   * is the toggle's job, not the close button's. Active-tab fallback
   * is handled by the state layer.
   */
  const closeSide = (terminalId: string): boolean => {
    // Validate before mutating: dropping a non-side record here would
    // unmount its xterm while the backend PTY leaks (no close sent).
    const term = deps.state.sides().find((t) => t.id === terminalId)
    if (!term) return false
    if (term.kind) {
      deps.postMessage({ type: "agentManager.terminal.close", terminalId })
      return true
    }
    deps.state.remove(terminalId)
    deps.postMessage({ type: "agentManager.terminal.close", terminalId })
    return true
  }

  /**
   * Kill every side terminal of a context except one, and make the
   * survivor the visible tab: the side-strip counterpart of the tab
   * bar's "Close Others".
   */
  const closeSideOthers = (terminalId: string) => {
    const key = deps.state.contextFor(terminalId)
    if (!key) return
    for (const term of deps.state.sidesForContext(key)) {
      if (term.id === terminalId) continue
      closeSide(term.id)
    }
    deps.state.setSideActive(key, terminalId)
    deps.state.requestFocus(terminalId)
  }

  /** Deliberately stop a running script terminal: kills its process tree. */
  const stopSide = (terminalId: string): boolean => {
    const term = deps.state.sides().find((t) => t.id === terminalId)
    if (!term?.kind) return false
    deps.postMessage({ type: "agentManager.terminal.stop", terminalId })
    return true
  }

  /** Make a side terminal the visible one in its panel and focus it. */
  const selectSide = (terminalId: string) => {
    const key = deps.state.contextFor(terminalId)
    if (!key) return
    deps.state.setSideActive(key, terminalId)
    deps.state.requestFocus(terminalId)
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

  return {
    closeTerminal,
    closeSide,
    closeSideOthers,
    stopSide,
    selectSide,
    middleClick,
    activate,
    deactivate,
    requestNew,
    requestSide,
    ensureSide,
    addSide,
    closeActive,
  }
}

export interface TerminalMessageHandlerDeps {
  state: TerminalStateControls
  activate: (id: string) => void
  saveTabMemory: () => void
  setSelection: (sel: string | typeof LOCAL) => void
  showError: (message: string) => void
  postMessage: (message: unknown) => void
  /**
   * Called with the context key ("local" or worktree id) and the new
   * terminal id once a `terminal.created` message lands. The main
   * component uses this hook to append the id to its per-context tab
   * order so the terminal renders at the end of the tab bar rather
   * than wherever `tabIds()`'s base composition happens to put it.
   */
  onCreated?: (contextKey: string, terminalId: string) => void
  /** Side terminal for a context finished creating. */
  onSideCreated?: (contextKey: string, terminalId: string, focus: boolean) => void
  /** Side terminal create failed for a context. */
  onSideError?: (contextKey: string) => void
  /** Side terminal was closed (locally or by the extension). */
  onSideClosed?: (contextKey: string, terminalId: string) => void
  /** A newly hydrated running script terminal belongs to the selected context. */
  onScriptRunning?: (contextKey: string, terminalId: string) => void
  /** The destination setting changed (live settings sync). */
  onDestinationChanged?: (destination: TerminalDestination) => void
}

type CreatedMessage = Extract<ExtensionMessage, { type: "agentManager.terminal.created" }>
type ScriptTerminalsMessage = Extract<ExtensionMessage, { type: "agentManager.scriptTerminals" }>

function handleCreated(deps: TerminalMessageHandlerDeps, msg: CreatedMessage) {
  // `target` is the plain protocol id (selection/tab-order keys); `key` is
  // the project-namespaced terminal-state key (same shape as syncScripts).
  const target = msg.worktreeId === null ? LOCAL : msg.worktreeId
  const key = msg.projectId ? `${msg.projectId}:${target}` : target
  const term = {
    id: msg.terminalId,
    title: msg.title,
    wsUrl: msg.wsUrl,
    font: msg.font,
    placement: msg.placement,
  }
  if (msg.placement === "side") {
    // Side terminals are answered to a specific pending request. A
    // missing or context-mismatched request means the webview was
    // reloaded (or the context is gone) — close the PTY again instead
    // of leaking it.
    const request = deps.state.completeSide(msg.createId)
    if (!request || request.contextKey !== key) {
      deps.postMessage({ type: "agentManager.terminal.close", terminalId: msg.terminalId })
      return
    }
    deps.state.add(key === LOCAL ? null : key, term)
    // The newest terminal becomes the visible one in its panel.
    deps.state.setSideActive(key, msg.terminalId)
    deps.onSideCreated?.(key, msg.terminalId, request.focus)
    return
  }
  deps.state.add(key === LOCAL ? null : key, term)
  deps.onCreated?.(target, msg.terminalId)
  deps.saveTabMemory()
  deps.setSelection(target)
  deps.activate(msg.terminalId)
}

function handleScriptTerminals(deps: TerminalMessageHandlerDeps, msg: ScriptTerminalsMessage) {
  const added = deps.state.syncScripts(msg.terminals)
  for (const term of added) {
    if (deps.state.scriptStatus(term.id)?.state === "running") deps.onScriptRunning?.(term.contextKey, term.id)
  }
}

/**
 * Wire handlers for the inbound terminal messages. Returns a dispatcher
 * that accepts each message type and returns true if it handled the
 * payload. Keeps all the terminal-specific routing logic out of the
 * main webview component.
 */
export function createTerminalMessageHandler(deps: TerminalMessageHandlerDeps) {
  return (msg: ExtensionMessage): boolean => {
    if (msg.type === "agentManager.terminal.created") {
      handleCreated(deps, msg)
      return true
    }
    if (msg.type === "agentManager.scriptTerminals") {
      handleScriptTerminals(deps, msg)
      return true
    }
    if (msg.type === "agentManager.terminal.closed") {
      const removed = deps.state.remove(msg.terminalId)
      if (deps.state.activeId() === msg.terminalId) deps.state.setActiveId(undefined)
      if (removed?.placement === "side") deps.onSideClosed?.(removed.contextKey, msg.terminalId)
      return true
    }
    if (msg.type === "agentManager.terminal.error") {
      const request = msg.createId ? deps.state.completeSide(msg.createId) : undefined
      if (request) deps.onSideError?.(request.contextKey)
      deps.showError(msg.message)
      return true
    }
    if (msg.type === "agentManager.terminal.destinationChanged") {
      deps.onDestinationChanged?.(msg.destination)
      return true
    }
    // The initial destination rides along on the state message. Claimed
    // here so the main webview handler stays free of terminal settings,
    // but reported as unhandled because the rest of that payload belongs
    // to the other subscribers.
    if (msg.type === "agentManager.state" && msg.terminalDestination) {
      deps.onDestinationChanged?.(msg.terminalDestination)
      return false
    }
    return false
  }
}
