import { getTokenStyleObject, stringifyTokenStyle, type ThemedToken } from "shiki"
import type { MarkdownToken } from "./markdown-worker-protocol"

/**
 * The shape the code renderer consumes: one token per style run, with a newline token between lines. Every producer,
 * the worker and the in-process highlighter, goes through this, so the renderer never sees two formats.
 */
export function highlightTokens(lines: ThemedToken[][]): MarkdownToken[] {
  return lines
    .flatMap((line, index) => (index === lines.length - 1 ? line : [...line, { content: "\n", offset: 0 }]))
    .map(highlightToken)
}

export function highlightToken(token: ThemedToken): MarkdownToken {
  return [token.content, stringifyTokenStyle(token.htmlStyle ?? getTokenStyleObject(token))]
}
