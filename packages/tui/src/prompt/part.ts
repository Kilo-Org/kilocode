import { displaySlice } from "./display"

export function stripPromptPartIDs<Part extends { id: string; messageID: string; sessionID: string }>(part: Part) {
  const { id: _id, messageID: _messageID, sessionID: _sessionID, ...rest } = part
  return rest
}

export function expandPastedTextPlaceholders(text: string, parts: readonly unknown[]) {
  return parts.reduce<string>((result, part) => {
    if (!isPastedTextPart(part)) return result
    return result.replace(part.source.text.value, part.text)
  }, text)
}

function isPastedTextPart(part: unknown): part is { type: "text"; text: string; source: { text: { value: string } } } {
  if (!part || typeof part !== "object" || !("type" in part) || part.type !== "text") return false
  if (!("text" in part) || typeof part.text !== "string" || !("source" in part)) return false
  const source = part.source
  if (!source || typeof source !== "object" || !("text" in source)) return false
  const text = source.text
  return Boolean(text && typeof text === "object" && "value" in text && typeof text.value === "string")
}

export function expandTrackedPastedText(text: string, ranges: { start: number; end: number; text: string }[]) {
  return ranges
    .slice()
    .sort((a, b) => b.start - a.start)
    .reduce((result, part) => displaySlice(result, 0, part.start) + part.text + displaySlice(result, part.end), text)
}

type PastePlaceholderInput = {
  extmarks: {
    getAllForTypeId(typeId: number): { id: number; start: number; end: number }[]
    delete(id: number): boolean
  }
  setSelection(start: number, end: number): void
  deleteSelection(): boolean
  insertText(text: string): void
  cursorOffset: number
}

/**
 * Replace a collapsed paste placeholder with its literal text.
 * Returns true when a placeholder holds exactly the pasted content.
 * The caller's content-change sync drops the text part that loses its extmark.
 */
export function expandPastedPlaceholder(
  input: PastePlaceholderInput,
  typeId: number,
  extmarkToPartIndex: ReadonlyMap<number, number>,
  parts: readonly unknown[],
  content: string,
) {
  const match = input.extmarks
    .getAllForTypeId(typeId)
    .filter((extmark) => {
      const partIndex = extmarkToPartIndex.get(extmark.id)
      if (partIndex === undefined) return false
      const part = parts[partIndex]
      return isPastedTextPart(part) && part.text === content
    })
    .sort((a, b) => a.start - b.start)[0]
  if (!match) return false

  input.extmarks.delete(match.id)
  input.setSelection(match.start, match.end)
  input.deleteSelection()
  input.cursorOffset = match.start
  input.insertText(content)
  return true
}
