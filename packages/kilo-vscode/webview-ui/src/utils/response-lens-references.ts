import type { ResponseLensReference } from "../../../src/shared/response-lens"

const extension =
  /\.(?:mdx?|txt|tsx?|jsx?|mjs|cjs|py|jsonc?|ya?ml|toml|ini|cfg|csv|xml|html?|css|scss|sh|ps1|go|rs|java|[ch]|cpp|hpp|sql|pdf|docx|rst|log)(?:#(?:L\d+(?:-L?\d+)?|page=\d+)|:\d+(?::\d+)?)?$/i

function clean(value: string) {
  let result = value.replace(/[.,;!?]+$/, "")
  while (result.endsWith(")") && (result.match(/\)/g)?.length ?? 0) > (result.match(/\(/g)?.length ?? 0))
    result = result.slice(0, -1)
  return result
}

function reference(target: string): ResponseLensReference | undefined {
  if (/^https?:\/\//i.test(target)) return { kind: "url", target }
  if (/^(?:file:\/\/|vscode:\/\/file\/)/i.test(target)) return { kind: "file", target }
  if (
    extension.test(target) ||
    /(?:^|[\\/])(?:README|LICENSE|Dockerfile|Makefile|\.gitignore|\.env(?:\.[\w.-]+)?)$/i.test(target)
  )
    return { kind: "file", target: target.replace(/^@(?=[\w.-]+\.)/, "") }
}

type Capture = { text: string; row: HTMLElement; range?: Range }

function anchorReferences(capture: Capture, add: (value: string, linked?: boolean) => void) {
  let body = capture.range?.toString() ?? capture.text
  const spans: { start: number; end: number }[] = []
  if (capture.range) {
    for (const link of capture.row.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (link.closest('[data-annotation-marker], [data-component="annotation-markers"]')) continue
      if (!capture.range.intersectsNode(link)) continue
      const range = capture.range.cloneRange()
      const bounds = link.ownerDocument.createRange()
      bounds.selectNodeContents(link)
      if (range.compareBoundaryPoints(range.START_TO_START, bounds) < 0)
        range.setStart(bounds.startContainer, bounds.startOffset)
      if (range.compareBoundaryPoints(range.END_TO_END, bounds) > 0) range.setEnd(bounds.endContainer, bounds.endOffset)
      if (!range.toString().trim()) continue
      const target = link.getAttribute("href")
      if (target && !target.startsWith("#")) add(target, true)
      const before = capture.range.cloneRange()
      before.setEnd(range.startContainer, range.startOffset)
      spans.push({ start: before.toString().length, end: before.toString().length + range.toString().length })
    }
  }
  for (const span of spans.sort((a, b) => b.start - a.start))
    body = body.slice(0, span.start) + " " + body.slice(span.end)
  return { body, linked: spans.length > 0 }
}

export function responseLensReferences(capture: Capture): ResponseLensReference[] {
  const refs: ResponseLensReference[] = []
  const add = (value: string, linked = false) => {
    const target = linked ? value.trim() : clean(value.trim())
    const item =
      reference(target) ??
      (linked && target
        ? { kind: /^[a-z][a-z\d+.-]*:/i.test(target) ? ("url" as const) : ("file" as const), target }
        : undefined)
    if (item && !refs.some((other) => other.kind === item.kind && other.target === item.target)) refs.push(item)
  }
  const anchors = anchorReferences(capture, add)
  let body = anchors.body
  body = body.replace(/\[[^\]\n]*\]\(((?:https?:\/\/|file:\/\/)[^\s)]+)\)/gi, (_whole, target: string) => {
    add(target, true)
    return " "
  })
  body = body.replace(/\b(?:https?:\/\/|file:\/\/|vscode:\/\/file\/)[^\s<>"`]+/gi, (value) => {
    add(value)
    return " "
  })
  body = body.replace(/[`"]([^`"\n]+)[`"]/g, (_whole, value: string) => {
    if (reference(value)) add(value, true)
    return " "
  })
  const element = capture.range?.commonAncestorContainer
  const code = (element?.nodeType === 1 ? (element as Element) : element?.parentElement)?.closest("code")
  if (!anchors.linked && code && code.textContent?.trim() === capture.text.trim() && reference(capture.text.trim()))
    add(capture.text, true)
  else for (const value of body.matchAll(/(?:[A-Za-z]:[\\/]|\.\.?[\\/])?[^\s<>"`|;,()[\]{}]+/g)) add(value[0])
  return refs.slice(0, 3)
}
