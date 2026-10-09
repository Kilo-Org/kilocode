import { type ParsedMemoryCommand } from "../../utils/memory-command"

export type SandboxDefaultState = {
  desired: boolean
  enabled: boolean
  available: boolean
  reason?: string
  revision: number
}

export type SandboxState = {
  sessionID: string
  enabled: boolean
  available: boolean
  reason?: string
  version: number
  directory: string
  revision: number
}

export function applySandboxState(current: SandboxState | undefined, next: SandboxState) {
  if (!current) return next
  const same = current.sessionID === next.sessionID && current.directory === next.directory
  if (same && current.version > next.version) return current
  if (same && current.version === next.version && current.revision > next.revision) return current
  if (!same && current.revision > next.revision) return current
  return next
}

export function applySandboxStates(current: Record<string, SandboxState>, next: SandboxState) {
  const previous = current[next.sessionID]
  const state = applySandboxState(previous, next)
  if (state === previous) return current
  return { ...current, [next.sessionID]: state }
}

// VS Code's webview preload intercepts Ctrl/Cmd+Z and Ctrl+Y and forwards them
// to the workbench, which can undo an unrelated editor (#13724). Callers must
// stop propagation, and because a webview keypress has no native undo default
// action on macOS, perform the edit with document.execCommand (#14191).
// Match keyCode like VS Code does so non-Latin layouts stay in lockstep.
export function undoKey(e: KeyboardEvent): "undo" | "redo" | undefined {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return
  const z = e.keyCode === 90 || e.key.toLowerCase() === "z"
  const y = e.keyCode === 89 || e.key.toLowerCase() === "y"
  if (z) return e.shiftKey ? "redo" : "undo"
  if (y && !e.shiftKey) return "redo"
}

export function fileName(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  return normalized.split("/").pop() ?? normalized
}

export function dirName(path: string): string {
  const parts = path.replaceAll("\\", "/").replace(/\/+$/, "").split("/")
  if (parts.length <= 1) return ""
  const dir = parts.slice(0, -1).join("/")
  return dir.length > 30 ? `…/${parts.slice(-3, -1).join("/")}` : dir
}

export function buildHighlightSegments(val: string, paths: Set<string>): { text: string; highlight: boolean }[] {
  if (paths.size === 0) return [{ text: val, highlight: false }]

  const segments: { text: string; highlight: boolean }[] = []
  let remaining = val

  while (remaining.length > 0) {
    let earliest = -1
    let earliestPath = ""

    for (const path of paths) {
      const token = `@${path}`
      const idx = remaining.indexOf(token)
      if (idx !== -1 && (earliest === -1 || idx < earliest)) {
        earliest = idx
        earliestPath = path
      }
    }

    if (earliest === -1) {
      segments.push({ text: remaining, highlight: false })
      break
    }

    if (earliest > 0) {
      segments.push({ text: remaining.substring(0, earliest), highlight: false })
    }

    const token = `@${earliestPath}`
    segments.push({ text: token, highlight: true })
    remaining = remaining.substring(earliest + token.length)
  }

  return segments
}

export function atEnd(start: number, end: number, len: number): boolean {
  return start === end && end === len
}

/** A collapsed paste: the full text lives here, the input only carries the placeholder. */
export type PasteRange = {
  id: number
  start: number
  end: number
  text: string
}

export type PromptSegment = {
  text: string
  kind: "plain" | "mention" | "paste"
  /** Paste id for a collapsed block, so a click can find its backing text. */
  paste?: number
}

/** Number of lines a pasted block occupies, matching the CLI's newline count plus one. */
export function promptLineCount(text: string): number {
  return (text.match(/\n/g)?.length ?? 0) + 1
}

/**
 * Whether a pasted block collapses into a `[Pasted ~N lines]` placeholder.
 *
 * The VS Code composer has more room than the CLI, so these thresholds are
 * higher than the CLI's five lines or 800 characters. Fifteen lines is just
 * past the ~11 lines the 200px composer shows before scrolling, and 4000
 * characters still catches a single enormous line that would otherwise wrap
 * into a wall of text. The line rule catches tall pastes of short lines that a
 * character count alone would miss.
 */
export function isCollapsiblePaste(text: string): boolean {
  return promptLineCount(text) >= 15 || text.length > 4000
}

/**
 * The placeholder shown for a collapsed paste. Kept as a stable English token so
 * every client renders and can rediscover the same block; it is literal text the
 * user could have typed, so anything without backing text is sent unchanged.
 */
export function pastePlaceholder(text: string): string {
  return `[Pasted ~${promptLineCount(text)} lines]`
}

const PASTE_PLACEHOLDER = /^\[Pasted ~\d+ lines\]$/
const PASTE_TOKEN = /\[Pasted ~\d+ lines\]/g

/** Every placeholder occurrence in `text`, in order, with its range. */
export function findPastePlaceholders(text: string): { start: number; end: number }[] {
  return Array.from(text.matchAll(PASTE_TOKEN), (match) => {
    const start = match.index ?? 0
    return { start, end: start + match[0].length }
  })
}

function validPaste(text: string, paste: PasteRange): boolean {
  if (paste.start < 0 || paste.end > text.length || paste.start >= paste.end) return false
  return PASTE_PLACEHOLDER.test(text.slice(paste.start, paste.end))
}

/** The single edited span between two versions of the same text. */
export function textDiff(prev: string, next: string): { start: number; oldEnd: number; newEnd: number; delta: number } {
  let start = 0
  const min = Math.min(prev.length, next.length)
  while (start < min && prev.charCodeAt(start) === next.charCodeAt(start)) start++
  let oldEnd = prev.length
  let newEnd = next.length
  while (oldEnd > start && newEnd > start && prev.charCodeAt(oldEnd - 1) === next.charCodeAt(newEnd - 1)) {
    oldEnd--
    newEnd--
  }
  return { start, oldEnd, newEnd, delta: newEnd - oldEnd }
}

/**
 * Move paste ranges across an edit. A block the edit only repositions keeps its
 * backing text; a range the edit touches is dropped, because the placeholder it
 * pointed at no longer exists. Ranges that no longer spell a placeholder are
 * dropped too, so native undo or a programmatic rewrite cannot leave a stale
 * range pointing at unrelated text.
 */
export function shiftPastes(pastes: readonly PasteRange[], prev: string, next: string): PasteRange[] {
  if (prev === next) return [...pastes]
  const diff = textDiff(prev, next)
  const out: PasteRange[] = []
  for (const paste of pastes) {
    if (paste.end <= diff.start) {
      if (validPaste(next, paste)) out.push(paste)
      continue
    }
    if (paste.start >= diff.oldEnd) {
      const moved = { ...paste, start: paste.start + diff.delta, end: paste.end + diff.delta }
      if (validPaste(next, moved)) out.push(moved)
      continue
    }
  }
  return out
}

/**
 * Move paste ranges across an edit the caller already knows exactly: it replaces
 * `[start, end)` with `length` characters of new text. Unlike `shiftPastes`,
 * which infers the edited span from two text versions, this uses the real span,
 * so two identical placeholders cannot be confused with one another.
 */
export function rebasePastes(pastes: readonly PasteRange[], start: number, end: number, length: number): PasteRange[] {
  const delta = length - (end - start)
  const out: PasteRange[] = []
  for (const paste of pastes) {
    if (paste.end <= start) {
      out.push(paste)
      continue
    }
    if (paste.start >= end) out.push({ ...paste, start: paste.start + delta, end: paste.end + delta })
  }
  return out
}

/**
 * The edit `[start, end)` describes when it accounts for the change from `prev`
 * to `next`, or undefined when it does not. A span captured before a native edit
 * can be stale — a rewrite may have landed instead — so the text on either side
 * of it is checked before it is trusted.
 */
export function spanEdit(
  prev: string,
  next: string,
  start: number,
  end: number,
): { start: number; end: number; length: number } | undefined {
  if (start < 0 || end < start || end > prev.length) return
  const length = next.length - prev.length + (end - start)
  if (length < 0) return
  if (prev.slice(0, start) !== next.slice(0, start)) return
  if (prev.slice(end) !== next.slice(start + length)) return
  return { start, end, length }
}

/**
 * The selection a `beforeinput` is about to replace — the span that tells two
 * identical placeholders apart — or undefined when there is none worth keeping:
 * a caret replaces nothing, and undo and redo replay a span of their own.
 */
export function inputSpan(
  event: InputEvent,
  textarea: HTMLTextAreaElement | undefined,
): { start: number; end: number } | undefined {
  if (!textarea || (event.inputType ?? "").startsWith("history")) return
  const start = textarea.selectionStart ?? 0
  const end = textarea.selectionEnd ?? 0
  if (start !== end) return { start, end }
}

/**
 * Build the text for a collapsed paste inserted at `[start, end)` together with
 * the chip range and the caret it should leave behind. The placeholder gains a
 * separating space on either side when the neighbouring text needs one, so the
 * chip range excludes those spaces while the caret lands after all of them.
 */
export function pasteInsertion(
  text: string,
  start: number,
  end: number,
  placeholder: string,
): { text: string; inserted: string; start: number; end: number; caret: number } {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const prefix = before.length > 0 && !/\s$/.test(before) ? " " : ""
  const suffix = after.length > 0 && !/^\s/.test(after) ? " " : ""
  const inserted = `${prefix}${placeholder}${suffix}`
  const rangeStart = before.length + prefix.length
  return {
    text: `${before}${inserted}${after}`,
    inserted,
    start: rangeStart,
    end: rangeStart + placeholder.length,
    caret: before.length + inserted.length,
  }
}

/** Replace every collapsed block in `text` with its full backing text. */
export function expandPastes(text: string, pastes: readonly PasteRange[]): string {
  let result = text
  const ordered = [...pastes].filter(validPaste.bind(null, text)).sort((a, b) => b.start - a.start)
  for (const paste of ordered) {
    result = result.slice(0, paste.start) + paste.text + result.slice(paste.end)
  }
  return result
}

/**
 * Split prompt text into plain runs, mention tokens, and collapsed paste chips.
 * Paste ranges win over mention detection because their text is never a mention.
 */
export function buildPromptSegments(text: string, paths: Set<string>, pastes: readonly PasteRange[]): PromptSegment[] {
  const segments: PromptSegment[] = []
  const ordered = [...pastes].filter(validPaste.bind(null, text)).sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const paste of ordered) {
    if (paste.start < cursor) continue
    if (paste.start > cursor) {
      for (const part of buildHighlightSegments(text.slice(cursor, paste.start), paths)) {
        segments.push({ text: part.text, kind: part.highlight ? "mention" : "plain" })
      }
    }
    segments.push({ text: text.slice(paste.start, paste.end), kind: "paste", paste: paste.id })
    cursor = paste.end
  }
  if (cursor < text.length) {
    for (const part of buildHighlightSegments(text.slice(cursor), paths)) {
      segments.push({ text: part.text, kind: part.highlight ? "mention" : "plain" })
    }
  }
  return segments
}

export function insertSpacedText(
  text: string,
  value: string,
  start: number,
  end: number,
): { text: string; pos: number } {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const prefix = before && !/\s$/.test(before) ? " " : ""
  const suffix = after && !/^\s/.test(after) ? " " : ""
  const inserted = `${prefix}${value}${suffix}`
  return {
    text: `${before}${inserted}${after}`,
    pos: before.length + inserted.length,
  }
}

/**
 * Whether the input prompt should be blocked.
 *
 * Only permission requests block the prompt in the VS Code webview. Questions
 * and suggestions never block — they are dismissed automatically when a new
 * message is sent (see session.tsx sendMessage/sendCommand).
 *
 * The single-parameter signature is intentional: taking question-count would
 * structurally allow a future regression to re-couple the prompt to pending
 * questions. Keep this function at one argument.
 */
export function isPromptBlocked(permissions: number): boolean {
  return permissions > 0
}

/**
 * Whether the session is busy from the prompt's perspective.
 * Returns false (idle-like) when the session is busy only because
 * a suggestion or question tool call is pending.
 */
export function isPromptBusy(status: string, suggesting: boolean, questioning: boolean, submitting: boolean): boolean {
  return submitting || (status !== "idle" && !suggesting && !questioning)
}

/**
 * Whether the session is busy only because a suggestion is pending.
 * True when no permission request is blocking the prompt and at least one
 * suggestion is active. The `!blocked` gate keeps the Stop button available
 * when permissions block input — it does NOT mean suggestions block.
 */
export function isSuggesting(blocked: boolean, suggestions: number): boolean {
  return !blocked && suggestions > 0
}

/**
 * Whether the session is busy only because a question is pending.
 * True when no permission request is blocking the prompt and at least one
 * question is active. The `!blocked` gate keeps the Stop button available
 * when permissions block input — it does NOT mean questions block.
 */
export function isQuestioning(blocked: boolean, questions: number): boolean {
  return !blocked && questions > 0
}

/** Whether a mention token refers to a file or folder path (not a special mention like terminal/git-changes). */
export function isPathMention(text: string): boolean {
  const path = text.replace(/^@/, "")
  return path !== "terminal" && path !== "git-changes"
}

/**
 * The text that should remain in the prompt input after a memory command is
 * submitted. No-argument memory operations (e.g. rebuild, on, status, inspect)
 * typed with trailing free text (e.g. "/memory rebuild hello") keep that text in
 * the input instead of discarding it; the parser reports the unconsumed
 * remainder as `rest`. Argument-taking operations (remember, correct, forget,
 * auto, purge) consume their text, so nothing remains.
 */
export function memoryRest(cmd: ParsedMemoryCommand): string {
  return "rest" in cmd ? (cmd.rest ?? "") : ""
}
