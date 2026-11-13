import { expect, test } from "bun:test"
import { patchCodeTokens } from "../../kilo-ui-base/src/kilocode/markdown-code-tokens"
import { shouldResetCodeTokens } from "../../kilo-ui-base/src/components/markdown-code-state"
import {
  applyMarkdownWorkerResponse,
  type MarkdownToken,
  type MarkdownWorkerState,
} from "../../kilo-ui-base/src/components/markdown-worker-protocol"

const tokens = (...values: string[]) => values.map((value): MarkdownToken => [value, ""])

const span = (token: MarkdownToken) => {
  const element = document.createElement("span")
  element.textContent = token[0]
  element.setAttribute("style", token[1])
  return element
}

const rendered = (state: MarkdownWorkerState, raw: string, code = document.createElement("code")) => ({
  code,
  language: "bash",
  generation: state.generation,
  stableCount: state.stable.length,
  unstable: state.unstable,
  raw,
})

test("a block highlighted again after its state was released replaces the rendered tokens", () => {
  // A settled block that still grows is highlighted as complete on every step, and each complete result releases
  // the key's state, so every response starts without one.
  const first = applyMarkdownWorkerResponse(undefined, {
    type: "highlight",
    id: 1,
    key: "block",
    reset: true,
    stable: tokens("kilo2", " ", "--for"),
    unstable: [],
  })
  const second = applyMarkdownWorkerResponse(undefined, {
    type: "highlight",
    id: 2,
    key: "block",
    reset: true,
    stable: tokens("kilo2", " ", "--format", " ", "json"),
    unstable: [],
  })

  expect(
    shouldResetCodeTokens(rendered(first, "```bash\nkilo2 --for"), {
      code: document.createElement("code"),
      language: "bash",
      generation: second.generation,
      stableCount: second.stable.length,
      raw: "```bash\nkilo2 --format json",
    }),
  ).toBe(true)
})

test("a streamed continuation keeps the generation", () => {
  const first = applyMarkdownWorkerResponse(undefined, {
    type: "highlight",
    id: 1,
    key: "block",
    reset: true,
    stable: tokens("kilo2", " "),
    unstable: tokens("--for"),
  })
  const next = applyMarkdownWorkerResponse(first, {
    type: "highlight",
    id: 2,
    key: "block",
    reset: false,
    stable: tokens("--format", " "),
    unstable: tokens("js"),
  })

  expect(next.generation).toBe(first.generation)
  expect(next.stable.map((token) => token[0])).toEqual(["kilo2", " ", "--format", " "])
})

test("a replaced code element resets the tokens instead of appending to it", () => {
  const code = document.createElement("code")
  const state = rendered(
    { id: 1, generation: 1, stable: tokens("kilo2"), unstable: [] },
    "```bash\nkilo2",
    code,
  )

  const replaced = document.createElement("code")
  expect(
    shouldResetCodeTokens(state, {
      code: replaced,
      language: "bash",
      generation: state.generation,
      stableCount: 2,
      raw: "```bash\nkilo2",
    }),
  ).toBe(true)
})

test("patching a block the highlighter rewrote drops its line-break text nodes", () => {
  // The progressive highlighter emits one line element per line with the line breaks between them as text nodes,
  // so patching that element without clearing them leaves a blank line for every line of the script.
  const code = document.createElement("code")
  const highlighted = document.createElement("div")
  highlighted.innerHTML = `<span class="line">old one</span>\n<span class="line">old two</span>\n<span class="line">old three</span>`
  code.append(...highlighted.childNodes)

  patchCodeTokens(code, tokens("first", "\n", "second"), span)

  expect(code.textContent).toBe("first\nsecond")
  expect(code.children).toHaveLength(3)
  expect([...code.childNodes].every((node) => node.nodeType === Node.ELEMENT_NODE)).toBe(true)
})
