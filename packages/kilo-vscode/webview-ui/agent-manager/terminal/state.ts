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
import type { ExtensionMessage } from "../../src/types/messages/extension-messages"
import type { TerminalDestination, TerminalFont, TerminalPlacement } from "../../src/types/messages/agent-manager"

export type { TerminalFont }

/** Prefix used for terminal tab IDs in the webview (mirrors terminal-manager.ts). */
export const TERMINAL_PREFIX = "terminal:"

export const isTerminalTabId = (id: string): boolean => id.startsWith(TERMINAL_PREFIX)

/** One row in `terminalsByContext`. `wsUrl` is short-lived and never persisted. */
export interface TerminalTabState {
  id: string
  title: string
  wsUrl: string
  font: TerminalFont
  placement: TerminalPlacement
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
 *  `cancelled` is set when the user closes the panel while the PTY is
 *  still starting; the late `created` answer is then closed again. */
interface SideRequest {
  contextKey: string
  cancelled: boolean
}

export interface TerminalStateControls {
  /** Record received from `terminal.created`. */
  add(worktreeId: string | null, term: TerminalTabState): void
  /** Drop a terminal from its context (location resolved automatically).
   *  Returns the removed record so callers can react to placement. */
  remove(terminalId: string): TerminalTabStateWithContext | undefined
  /** Resolve the context key a terminal lives in, if any. */
  contextFor(terminalId: string): string | undefined
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
  /** The side terminal of the current context, if any. */
  side: Accessor<TerminalTabStateWithContext | undefined>
  /** The side terminal of an arbitrary context, if any. */
  sideForContext(contextKey: string): TerminalTabStateWithContext | undefined
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
  /** Request id of the in-flight side-terminal create for a context. */
  pendingSide(contextKey: string): string | undefined
  /** Mark a side-terminal create as in flight for a context. */
  beginSide(contextKey: string, createId: string): void
  /** Cancel the in-flight create; returns true when one was pending. */
  cancelSide(contextKey: string): boolean
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
  let focusSerial = 0
  // In-flight side-terminal creates, keyed both ways: per context (what
  // the panel shows) and per request id (what the answer carries).
  const [pending, setPending] = createSignal<Record<string, string>>({})
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

  const sideForContext = (key: string) => terminalsByContext()[key]?.find((t) => t.placement === "side")
  const side = () => sideForContext(sideKey())

  const lookup = () => new Map(current().map((t) => [t.id, t]))

  const contextFor = (terminalId: string): string | undefined => {
    for (const [key, terms] of Object.entries(terminalsByContext())) {
      if (terms.some((t) => t.id === terminalId)) return key
    }
    return undefined
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
      // One side terminal per context; the message handler dedupes via
      // pending requests, this guard covers stale double answers.
      if (term.placement === "side" && list.some((t) => t.placement === "side")) return prev
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
    return removed
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

  const pendingSide = (key: string) => pending()[key]

  const beginSide = (key: string, createId: string) => {
    requests.set(createId, { contextKey: key, cancelled: false })
    setPending((prev) => ({ ...prev, [key]: createId }))
  }

  const cancelSide = (key: string): boolean => {
    const id = pending()[key]
    if (!id) return false
    const request = requests.get(id)
    if (request) request.cancelled = true
    setPending((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    return true
  }

  const completeSide = (createId: string): SideRequest | undefined => {
    const request = requests.get(createId)
    if (!request) return undefined
    requests.delete(createId)
    setPending((prev) => {
      if (prev[request.contextKey] !== createId) return prev
      const next = { ...prev }
      delete next[request.contextKey]
      return next
    })
    return request
  }

  return {
    add,
    remove,
    contextFor,
    forSelection,
    lookup,
    current,
    all,
    sides,
    side,
    sideForContext,
    currentKey,
    sideKey,
    activeId,
    setActiveId,
    focusedId,
    setFocusedId,
    focusRequest,
    requestFocus,
    hasRemembered,
    reorder,
    reorderDrag,
    pendingSide,
    beginSide,
    cancelSide,
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
  /** Leave terminal mode without killing the terminal. */
  onHideSide: () => void
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

  /**
   * Reveal the side panel and create-or-focus the context's side
   * terminal. Reuses the existing terminal when one is alive, dedupes
   * against an in-flight create, and never touches the tab strip or
   * the chat session.
   */
  const requestSide = () => {
    const key = deps.state.sideKey()
    deps.onShowSide(key)
    const existing = deps.state.sideForContext(key)
    if (existing) {
      deps.state.requestFocus(existing.id)
      return
    }
    if (deps.state.pendingSide(key)) return
    const id = newId()
    deps.state.beginSide(key, id)
    const sel = deps.getSelection()
    deps.postMessage({
      type: "agentManager.terminal.create",
      createId: id,
      placement: "side",
      worktreeId: sel === null || sel === deps.LOCAL ? null : sel,
    })
  }

  const closeTerminal = (terminalId: string) => {
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
   * Kill the current context's side terminal and hide the panel. With
   * a create still in flight, cancels it instead — the late answer is
   * closed by the message handler.
   */
  const closeSide = () => {
    const term = deps.state.side()
    deps.onHideSide()
    if (!term) return deps.state.cancelSide(deps.state.sideKey())
    deps.state.remove(term.id)
    deps.postMessage({ type: "agentManager.terminal.close", terminalId: term.id })
    return true
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

  return { closeTerminal, closeSide, middleClick, activate, deactivate, requestNew, requestSide, closeActive }
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
  onSideCreated?: (contextKey: string, terminalId: string) => void
  /** Side terminal create failed for a context. */
  onSideError?: (contextKey: string) => void
  /** Side terminal was closed (locally or by the extension). */
  onSideClosed?: (contextKey: string) => void
  /** The destination setting changed (live settings sync). */
  onDestinationChanged?: (destination: TerminalDestination) => void
}

type CreatedMessage = Extract<ExtensionMessage, { type: "agentManager.terminal.created" }>

function handleCreated(deps: TerminalMessageHandlerDeps, msg: CreatedMessage) {
  const contextKey = msg.worktreeId === null ? LOCAL : msg.worktreeId
  const term = {
    id: msg.terminalId,
    title: msg.title,
    wsUrl: msg.wsUrl,
    font: msg.font,
    placement: msg.placement,
  }
  if (msg.placement === "side") {
    // Side terminals are answered to a specific pending request. A
    // missing, cancelled, or context-mismatched request means the user
    // already moved on — close the PTY again instead of leaking it.
    const request = deps.state.completeSide(msg.createId)
    if (!request || request.cancelled || request.contextKey !== contextKey) {
      deps.postMessage({ type: "agentManager.terminal.close", terminalId: msg.terminalId })
      return
    }
    deps.state.add(msg.worktreeId, term)
    deps.onSideCreated?.(contextKey, msg.terminalId)
    return
  }
  deps.state.add(msg.worktreeId, term)
  deps.onCreated?.(contextKey, msg.terminalId)
  deps.saveTabMemory()
  deps.setSelection(contextKey)
  deps.activate(msg.terminalId)
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
    if (msg.type === "agentManager.terminal.closed") {
      const removed = deps.state.remove(msg.terminalId)
      if (deps.state.activeId() === msg.terminalId) deps.state.setActiveId(undefined)
      if (removed?.placement === "side") deps.onSideClosed?.(removed.contextKey)
      return true
    }
    if (msg.type === "agentManager.terminal.error") {
      const request = msg.createId ? deps.state.completeSide(msg.createId) : undefined
      // Errors for requests the user already cancelled are noise.
      if (request?.cancelled) return true
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
