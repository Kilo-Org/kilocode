import { marked, type Token, type Tokens } from "marked"

export type MarkdownRange = {
  start: number
  end: number
}

export type MarkdownBlock =
  | { type: "block"; start: number; end: number }
  | { type: "list"; start: number; end: number; items: MarkdownRange[] }
  | { type: "table"; start: number; end: number; rows: MarkdownRange[] }

type Cursor = {
  line: number
  offset: number
}

function advance(pos: Cursor, raw: string): Cursor {
  const matches = raw.match(/\n/g)
  return { line: pos.line + (matches?.length ?? 0), offset: pos.offset + raw.length }
}

function span(pos: Cursor, raw: string): MarkdownRange {
  const next = advance(pos, raw)
  const trailing = raw.endsWith("\n") ? 1 : 0
  return { start: pos.line, end: Math.max(pos.line, next.line - trailing) }
}

function lineCount(raw: string): number {
  return Math.max(1, raw.replace(/\n+$/, "").split("\n").length)
}

function list(token: Tokens.List, range: MarkdownRange): MarkdownBlock {
  let line = range.start
  const items = token.items.map((item) => {
    const size = lineCount(item.raw)
    const next = { start: line, end: line + size - 1 }
    line += size
    return next
  })
  return { type: "list", ...range, items }
}

function table(raw: string, range: MarkdownRange): MarkdownBlock {
  const rows = raw
    .replace(/\n+$/, "")
    .split("\n")
    .map((_, index) => range.start + index)
    .filter((line, index) => index !== 1 && line <= range.end)
    .map((line) => ({ start: line, end: line }))
  return { type: "table", ...range, rows }
}

function block(token: Token, range: MarkdownRange): MarkdownBlock {
  if (token.type === "list") return list(token as Tokens.List, range)
  if (token.type === "table") return table(token.raw, range)
  return { type: "block", ...range }
}

export function markdownCommentBlocks(text: string): MarkdownBlock[] {
  const tokens = marked.lexer(text)
  const result: MarkdownBlock[] = []
  let pos = { line: 1, offset: 0 }

  for (const token of tokens) {
    const raw = token.raw ?? ""
    const index = text.indexOf(raw, pos.offset)
    if (index > pos.offset) pos = advance(pos, text.slice(pos.offset, index))
    const range = span(pos, raw)
    if (token.type !== "space") result.push(block(token, range))
    pos = advance(pos, raw)
  }

  return result
}
