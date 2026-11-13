import type { MarkdownToken } from "./markdown-worker-protocol"

export type RenderedCodeState = {
  /** The element these tokens were written to. A highlighted block replaces it, and the new element is not ours. */
  code: HTMLElement
  language: string
  generation: number
  stableCount: number
  unstable: MarkdownToken[]
  raw: string
}

export function shouldResetCodeTokens(
  previous: RenderedCodeState | undefined,
  next: { code: HTMLElement; language: string; generation: number; stableCount: number; raw: string },
) {
  return (
    !previous ||
    previous.code !== next.code ||
    previous.language !== next.language ||
    previous.generation !== next.generation ||
    next.stableCount < previous.stableCount ||
    !next.raw.startsWith(previous.raw)
  )
}
