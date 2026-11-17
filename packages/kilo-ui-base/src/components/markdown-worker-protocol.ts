import { getTokenStyleObject, stringifyTokenStyle, type ThemedToken, type ThemeRegistrationResolved } from "shiki"

export type MarkdownToken = [content: string, style: string]

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

export type MarkdownWorkerRequest =
  | { type: "init"; theme: ThemeRegistrationResolved }
  | { type: "highlight"; id: number; key: string; text: string; language: string; complete?: boolean }
  | { type: "dispose"; key: string }

export type MarkdownWorkerResponse =
  | {
      type: "highlight"
      id: number
      key: string
      reset: boolean
      stable: MarkdownToken[]
      unstable: MarkdownToken[]
    }
  | { type: "error"; id: number; key: string; message: string }
  | { type: "superseded"; id: number; key: string }

export type MarkdownWorkerState = {
  id: number
  generation: number
  stable: MarkdownToken[]
  unstable: MarkdownToken[]
}

export function shouldReleaseMarkdownWorkerState(complete: boolean, latestID: number | undefined, responseID: number) {
  return complete && latestID === responseID
}

export function markdownBlockKey(owner: string, cacheKey: string | undefined, index: number, mode: string) {
  return `${owner}:${cacheKey ? `${cacheKey}:${index}:${mode}` : `block:${index}`}`
}

// A complete highlight releases its key's state, so a block that is highlighted again (a settled message whose text
// still grows while the reveal drains) starts without one. A per-key count would then repeat the generation the DOM
// already shows, and the renderer would append the new tokens to the old spans instead of replacing them.
let generations = 0

export function nextMarkdownGeneration() {
  return ++generations
}

export function applyMarkdownWorkerResponse(
  state: MarkdownWorkerState | undefined,
  response: Extract<MarkdownWorkerResponse, { type: "highlight" }>,
) {
  if (state && response.id <= state.id) return state
  return {
    id: response.id,
    generation: response.reset || !state ? ++generations : state.generation,
    stable: response.reset ? response.stable : [...(state?.stable ?? []), ...response.stable],
    unstable: response.unstable,
  }
}
