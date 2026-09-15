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
 * Thresholds match the CLI and the JetBrains plugin: five lines or more, or
 * more than 800 characters.
 */
export function isCollapsiblePaste(text: string): boolean {
  return promptLineCount(text) >= 5 || text.length > 800
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

/** Every placeholder occurrence in `text`, in order, with its range. */
export function findPastePlaceholders(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let index = text.indexOf("[Pasted ~")
  while (index !== -1) {
    const end = text.indexOf("]", index)
    const candidate = end === -1 ? "" : text.slice(index, end + 1)
    if (PASTE_PLACEHOLDER.test(candidate)) {
      out.push({ start: index, end: end + 1 })
      index = text.indexOf("[Pasted ~", end + 1)
      continue
    }
    index = text.indexOf("[Pasted ~", index + 1)
  }
  return out
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
