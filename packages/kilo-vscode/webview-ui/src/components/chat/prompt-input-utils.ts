export function fileName(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  return normalized.split("/").pop() ?? normalized
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
  kind: "plain" | "paste"
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
 * Fifteen lines is just past the lines a 200px composer shows before scrolling,
 * and 4000 characters catches a single enormous line that would wrap into a
 * wall of text. The line rule catches tall pastes of short lines.
 */
export function isCollapsiblePaste(text: string): boolean {
  return promptLineCount(text) >= 15 || text.length > 4000
}

/**
 * The placeholder shown for a collapsed paste. It is literal text the user
 * could have typed, so anything without backing text is sent unchanged.
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
  // A repeated character pulls the common prefix forward when the user types at a paste chip's edge. Move a pure
  // insertion back over the run, so the edited span starts before the chip and the chip keeps its backing text.
  if (oldEnd === start) {
    while (start > 0 && prev.charCodeAt(start - 1) === next.charCodeAt(newEnd - 1)) {
      start--
      newEnd--
    }
    oldEnd = start
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
    // A diff that backtracks over a repeated character can start inside the placeholder. The chip did not move when
    // its old range still spells a placeholder in the new text, so keep it before the position rules drop it.
    if (validPaste(next, paste)) {
      out.push(paste)
      continue
    }
    if (paste.end <= diff.start) {
      if (validPaste(next, paste)) out.push(paste)
      continue
    }
    if (paste.start >= diff.oldEnd) {
      const moved = { ...paste, start: paste.start + diff.delta, end: paste.end + diff.delta }
      if (validPaste(next, moved)) out.push(moved)
    }
  }
  return out
}

/**
 * Move paste ranges across an edit the caller already knows exactly: it replaces
 * `[start, end)` with `length` characters of new text. The real span keeps two
 * identical placeholders apart, which a text diff cannot do.
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
 * can be stale, so the text on either side of it is checked before it is trusted.
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
 * The selection a `beforeinput` is about to replace, or undefined when there is
 * none worth keeping: a caret replaces nothing, and undo and redo replay a span
 * of their own.
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

/** Split prompt text into plain runs and collapsed paste chips. */
export function buildPromptSegments(text: string, pastes: readonly PasteRange[]): PromptSegment[] {
  const segments: PromptSegment[] = []
  const ordered = [...pastes].filter(validPaste.bind(null, text)).sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const paste of ordered) {
    if (paste.start < cursor) continue
    if (paste.start > cursor) segments.push({ text: text.slice(cursor, paste.start), kind: "plain" })
    segments.push({ text: text.slice(paste.start, paste.end), kind: "paste", paste: paste.id })
    cursor = paste.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), kind: "plain" })
  return segments
}
