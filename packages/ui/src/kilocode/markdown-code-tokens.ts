import type { MarkdownToken } from "../components/markdown-worker-protocol"

/**
 * Apply re-tokenized code spans in place. Markdown recreates every span when a
 * code fence closes or a stream settles, which destroys any text selection the
 * user holds inside the block. Patching the existing spans keeps them mounted.
 */
export function patchCodeTokens(
  code: HTMLElement,
  tokens: MarkdownToken[],
  createSpan: (token: MarkdownToken) => HTMLElement,
) {
  const spans = [...code.children]
  tokens.forEach((token, index) => {
    const span = spans[index]
    if (!(span instanceof HTMLElement)) {
      code.appendChild(createSpan(token))
      return
    }
    if (span.textContent !== token[0]) span.textContent = token[0]
    if (span.getAttribute("style") !== token[1]) span.setAttribute("style", token[1])
  })
  while (code.children.length > tokens.length) code.lastElementChild?.remove()
}
