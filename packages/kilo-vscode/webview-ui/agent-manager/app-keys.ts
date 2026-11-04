/**
 * Window-level input of the Agent Manager: host actions, the browser defaults our shortcuts must keep from firing,
 * the delete confirmation on a selected worktree, focus recovery, and the new-task request of the chat.
 */
import type { Setter } from "solid-js"
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

const PREVENT_WITH_COMMAND = new Set(["t", "w", "n", "d", "e", "f"])
const PREVENT_WITH_COMMAND_SHIFT = new Set(["t", "m", "w", "n", "o", "r", "[", "]"])
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

export function bindAppKeys(opts: {
  handlers: AppActionHandlers
  openHistory: () => void
  press: (event: KeyboardEvent) => void
  isDiffFocusTarget: (target: EventTarget | null) => boolean
  selection: () => string | null
  closeWorktree: () => void
  setHeld: Setter<boolean>
  focusReport: () => void
  restoreFocus: () => void
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
    if (action === "cycleAgentMode" && document.hasFocus()) {
      opts.handlers.cycleAgentMode()
      return
    }
    if (action === "cyclePreviousAgentMode" && document.hasFocus()) {
      opts.handlers.cyclePreviousAgentMode()
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
    if (!(event.metaKey || event.ctrlKey)) return
    const target = event.target as HTMLElement | null
    if (target?.closest("[data-agent-manager-native-text-shortcuts]")) return
    const key = event.key.toLowerCase()
    if (event.altKey && ARROWS.has(event.key)) event.preventDefault()
    if (!event.shiftKey && PREVENT_WITH_COMMAND.has(key)) event.preventDefault()
    if (event.shiftKey && PREVENT_WITH_COMMAND_SHIFT.has(key)) event.preventDefault()
    if (event.shiftKey && (event.key === "/" || event.key === "?")) event.preventDefault()
    if (/^[1-9]$/.test(event.key)) event.preventDefault()
  }

  const deleteKeyHandler = (event: KeyboardEvent) => {
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
    opts.restoreFocus()
  }

  const shortcut = (event: KeyboardEvent) => opts.press(event)

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
