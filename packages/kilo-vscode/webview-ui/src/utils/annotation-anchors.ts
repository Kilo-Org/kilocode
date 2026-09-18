import type { AnnotationAnchor } from "../../../src/shared/annotations"

const excluded =
  'button, [role="button"], [data-annotation-marker], [aria-hidden="true"], [hidden], script, style, .selection-toolbar'

function source(row: HTMLElement) {
  const walker = row.ownerDocument.createTreeWalker(row, 4)
  const nodes: { node: Text; start: number; end: number }[] = []
  let text = ""
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const element = node.parentElement
    if (
      !element?.closest('[data-component="text-part"]') ||
      element.closest(excluded) ||
      element.closest('[data-row="assistant"]') !== row
    )
      continue
    nodes.push({ node, start: text.length, end: text.length + node.length })
    text += node.data
  }
  return { text, nodes }
}

const digest = async (text: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")

function selected(row: HTMLElement, range: Range) {
  const snapshot = source(row)
  const nodes = snapshot.nodes.filter(
    ({ node }) =>
      range.intersectsNode(node) && range.comparePoint(node, node.length) !== -1 && range.comparePoint(node, 0) !== 1,
  )
  const first = nodes.at(0)
  const last = nodes.at(-1)
  if (!first || !last) return
  const start = first.start + (range.startContainer === first.node ? range.startOffset : 0)
  const end = last.start + (range.endContainer === last.node ? range.endOffset : last.node.length)
  if (start >= end) return
  return { ...snapshot, start, end, quote: snapshot.text.slice(start, end) }
}

export function annotationSelectionText(row: HTMLElement, range: Range): string | undefined {
  return selected(row, range)?.quote
}

export async function captureAnnotationAnchor(row: HTMLElement, range: Range): Promise<AnnotationAnchor | undefined> {
  // Read all DOM positions before hashing. No live Range or full source text is persisted.
  const value = selected(row, range)
  if (!value || value.text.length > 2_000_000 || value.quote.length > 2000) return
  return {
    start: value.start,
    end: value.end,
    quote: value.quote,
    prefix: value.text.slice(Math.max(0, value.start - 64), value.start),
    suffix: value.text.slice(value.end, value.end + 64),
    length: value.text.length,
    digest: await digest(value.text),
  }
}

export type AnnotationSourceCache = Map<HTMLElement, ReturnType<typeof source> & { digest: Promise<string> }>

export async function resolveAnnotationAnchor(
  row: HTMLElement,
  anchor: AnnotationAnchor,
  cache?: AnnotationSourceCache,
): Promise<Range | undefined> {
  const cached = cache?.get(row)
  const snapshot = cached ?? source(row)
  const hash = cached?.digest ?? digest(snapshot.text)
  if (!cached) cache?.set(row, { ...snapshot, digest: hash })
  if (
    snapshot.text.length !== anchor.length ||
    snapshot.text.slice(anchor.start, anchor.end) !== anchor.quote ||
    snapshot.text.slice(Math.max(0, anchor.start - 64), anchor.start) !== anchor.prefix ||
    snapshot.text.slice(anchor.end, anchor.end + 64) !== anchor.suffix ||
    (await hash) !== anchor.digest
  )
    return
  if (
    !row.isConnected ||
    (!cache &&
      (snapshot.nodes.some(({ node }) => !row.contains(node)) ||
        snapshot.nodes.map(({ node }) => node.data).join("") !== snapshot.text))
  )
    return
  const first = snapshot.nodes.find(({ start, end }) => start <= anchor.start && end > anchor.start)
  const last = snapshot.nodes.find(({ start, end }) => start < anchor.end && end >= anchor.end)
  if (!first || !last || !row.contains(first.node) || !row.contains(last.node)) return
  const range = row.ownerDocument.createRange()
  range.setStart(first.node, anchor.start - first.start)
  range.setEnd(last.node, anchor.end - last.start)
  return range
}
