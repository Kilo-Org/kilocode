// Locates a quoted passage of an assistant answer. A passage is stored as the text part it belongs to, the quoted
// text and its character offset in that part, so it can be found again after the virtualized row remounts.
import type { ChatReferenceData } from "../../../src/shared/review-comments"

const BODY = '[data-slot="text-part-body"]'
// Node.ELEMENT_NODE and NodeFilter.SHOW_TEXT, spelled out so the module does not depend on window globals.
const ELEMENT = 1
const SHOW_TEXT = 4

export type ReplyAnchor = Pick<ChatReferenceData, "messageID" | "partID" | "offset" | "quote">

/**
 * The anchor of a selection that starts inside one text part of an assistant answer. A selection that runs past the
 * end of that text, as a triple-click on the last paragraph does, is cut at the end of the text.
 */
export function selectionAnchor(range: Range): ReplyAnchor | undefined {
  const node = range.startContainer
  const body = (node.nodeType === ELEMENT ? (node as Element) : node.parentElement)?.closest<HTMLElement>(BODY)
  const part = body?.closest<HTMLElement>("[data-part-id]")
  const row = body?.closest<HTMLElement>('[data-row="assistant"][data-message]')
  if (!body || !part?.dataset.partId || !row?.dataset.message) return undefined
  const inside = range.cloneRange()
  if (!body.contains(range.endContainer)) inside.setEnd(body, body.childNodes.length)
  const before = body.ownerDocument.createRange()
  before.setStart(body, 0)
  before.setEnd(inside.startContainer, inside.startOffset)
  const start = before.toString().length
  const span = wholeWords(body.textContent ?? "", start, start + inside.toString().length)
  if (!span) return undefined
  return { messageID: row.dataset.message, partID: part.dataset.partId, ...span }
}

/**
 * The quote between two offsets of `text`, widened to whole words and trimmed. A drag rarely starts or ends exactly on
 * a word boundary, and a quote that starts mid-word reads like a mistake.
 */
export function wholeWords(text: string, from: number, to: number): { offset: number; quote: string } | undefined {
  const word = /[\p{L}\p{N}_]/u
  let start = from
  let end = to
  while (start > 0 && start < end && word.test(text[start - 1]!) && word.test(text[start]!)) start--
  while (end < text.length && end > start && word.test(text[end]!) && word.test(text[end - 1]!)) end++
  const raw = text.slice(start, end)
  const quote = raw.trim()
  if (!quote) return undefined
  return { offset: start + raw.length - raw.trimStart().length, quote }
}

/** The range of an anchored passage in the mounted rows under `root`, if its row is mounted and still has the text. */
export function anchorRange(root: ParentNode, anchor: ReplyAnchor): Range | undefined {
  const body = Array.from(root.querySelectorAll<HTMLElement>("[data-part-id]"))
    .find(
      (part) =>
        part.dataset.partId === anchor.partID &&
        part.closest<HTMLElement>("[data-message]")?.dataset.message === anchor.messageID,
    )
    ?.querySelector<HTMLElement>(BODY)
  if (!body) return undefined
  const start = findQuote(body.textContent ?? "", anchor.quote, anchor.offset)
  if (start === undefined) return undefined
  return textRange(body, start, start + anchor.quote.length)
}

/**
 * Where `quote` starts in `text`. The recorded offset wins when it still matches; otherwise the occurrence nearest to
 * it, because the rendered text can shift a little, for example when a code block finishes highlighting.
 */
export function findQuote(text: string, quote: string, offset: number): number | undefined {
  if (text.startsWith(quote, offset)) return offset
  let best: number | undefined
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    if (best === undefined || Math.abs(at - offset) < Math.abs(best - offset)) best = at
  }
  return best
}

function textRange(scope: HTMLElement, start: number, end: number): Range | undefined {
  const walker = scope.ownerDocument.createTreeWalker(scope, SHOW_TEXT)
  const range = scope.ownerDocument.createRange()
  let pos = 0
  let started = false
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node as Text).data.length
    if (!started && start < pos + length) {
      range.setStart(node, start - pos)
      started = true
    }
    if (started && end <= pos + length) {
      range.setEnd(node, end - pos)
      return range
    }
    pos += length
  }
  return undefined
}
