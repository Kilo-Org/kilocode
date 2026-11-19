/**
 * Window-level input of the Agent Manager: host actions, the browser defaults our shortcuts must keep from firing,
 * the delete confirmation on a selected worktree, focus recovery, and the new-task request of the chat.
 */
import type { Setter } from "solid-js"
import { blocksBrowserDefault } from "./chords"
import { LOCAL } from "./navigate"

export interface AppActionHandlers {
  sessionPrevious: () => void
  sessionNext: () => void
  tabPrevious: () => void
  tabNext: () => void
  terminalPrevious: () => void
  terminalNext: () => void
  search: () => void
  showTerminal: () => void
  toggleDiff: () => void
  newTab: () => void
  closeTask: () => void
  closeAllTasks: () => void
  closeTab: () => void
  newWorktree: () => void
  quickWorktree: () => void
  openWorktree: () => void
  updateFromBase: () => void
  openPR: () => void
  runScript: () => void
  advancedWorktree: () => void
  closeWorktree: () => void
  showShortcuts: () => void
  focusInput: () => void
  focusSearch: () => void
  newTerminalTab: () => void
  newSideTerminal: () => void
  cycleAgentMode: () => void
  cyclePreviousAgentMode: () => void
  jump: (index: number) => void
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

export function bindAppKeys(opts: {
  handlers: AppActionHandlers
  /** A hosted surface has no local tab, terminal, or worktree for a command to act on. */
  hosted?: () => boolean
  hostedAction?: (name: string) => void
  openHistory: () => void
  press: (event: KeyboardEvent) => void
  isDiffFocusTarget: (target: EventTarget | null) => boolean
  selection: () => string | null
  closeWorktree: () => void
  setHeld: Setter<boolean>
  focusReport: () => void
  restoreFocus: () => void
  terminalFocused: () => boolean
  createDraft: (selection: string) => { id: string }
  setActiveTerminal: (id: undefined) => void
  postToWorktree: (worktreeId: string) => void
  cleanupDrafts: () => void
}): () => void {
  const actionHandler = (msg: { type?: string; action?: string; view?: string }) => {
    if (msg.type === "navigate" && msg.view === "history") {
      opts.openHistory()
      return
    }
    if (msg.type !== "action") return
    const action = msg.action ?? ""
    if (opts.hosted?.() && !isProjectNavigation(action)) {
      opts.hostedAction?.(action)
      return
    }
    // Agent cycling acts on the composer the user types in: not from another surface, and not from a terminal.
    if (action === "cycleAgentMode" || action === "cyclePreviousAgentMode") {
      if (document.hasFocus() && !opts.terminalFocused()) opts.handlers[action]()
      return
    }
    const jump = /^jumpTo([1-9])$/.exec(action)
    if (jump) {
      opts.handlers.jump(Number(jump[1]) - 1)
      return
    }
    const handler = opts.handlers[action as keyof AppActionHandlers] as (() => void) | undefined
    if (typeof handler === "function") handler()
  }

  const messageHandler = (event: MessageEvent) => actionHandler(event.data ?? {})

  const preventDefaults = (event: KeyboardEvent) => {
    if (opts.hosted?.()) return
    const target = event.target as HTMLElement | null
    if (target?.closest("[data-agent-manager-native-text-shortcuts]")) return
    if (blocksBrowserDefault(event, isMac)) event.preventDefault()
  }

  const deleteKeyHandler = (event: KeyboardEvent) => {
    if (opts.hosted?.()) return
    if (event.key !== "Delete" && event.key !== "Backspace") return
    if (opts.isDiffFocusTarget(event.target)) return
    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return
    const selection = opts.selection()
    if (!selection || selection === LOCAL) return
    event.preventDefault()
    opts.closeWorktree()
  }

  const newTaskHandler = (event: Event) => {
    if (opts.hosted?.()) return
    const selection = opts.selection()
    if (!selection || selection === LOCAL) return
    event.stopImmediatePropagation()
    const draft = opts.createDraft(selection)
    window.dispatchEvent(new CustomEvent("agentManagerCaptureDraft", { detail: { id: draft.id } }))
    opts.setActiveTerminal(undefined)
    opts.postToWorktree(selection)
  }

  const onWindowFocus = () => {
    document.body.style.pointerEvents = ""
    document.body.style.overflow = ""
    opts.focusReport()
    if (!opts.hosted?.()) opts.restoreFocus()
  }

  const shortcut = (event: KeyboardEvent) => {
    if (!opts.hosted?.()) opts.press(event)
  }

  window.addEventListener("message", messageHandler)
  window.addEventListener("keydown", preventDefaults, true)
  window.addEventListener("keydown", shortcut, true)
  window.addEventListener("keydown", deleteKeyHandler)
  window.addEventListener("focus", onWindowFocus)
  window.addEventListener("newTaskRequest", newTaskHandler, true)

  return () => {
    window.removeEventListener("message", messageHandler)
    window.removeEventListener("keydown", preventDefaults, true)
    window.removeEventListener("keydown", shortcut, true)
    window.removeEventListener("keydown", deleteKeyHandler)
    window.removeEventListener("focus", onWindowFocus)
    window.removeEventListener("newTaskRequest", newTaskHandler, true)
    opts.cleanupDrafts()
  }
}

export { isMac }

function isProjectNavigation(action: string) {
  return ["search", "showShortcuts", "sessionPrevious", "sessionNext"].includes(action) || /^jumpTo[1-9]$/.test(action)
}
