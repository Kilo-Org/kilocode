import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { Markdown } from "../src/components/markdown"
import { highlightInProcess } from "../../kilo-ui-base/src/components/markdown-worker"
import { mountRich, waitFor, type Mounted } from "./harness"

// The VS Code webview cannot construct the highlighting worker from its resource origin. Whether a Worker can be
// constructed here depends on the environment, so the premise is made explicit instead of assumed.
const WorkerImplementation = globalThis.Worker

beforeAll(() => {
  globalThis.Worker = class {
    constructor() {
      throw new Error("worker unavailable")
    }
  } as unknown as typeof Worker
})

afterAll(() => {
  globalThis.Worker = WorkerImplementation
})

const source = [
  "class History<T> {",
  "  private values: T[] = []",
  "  private index = -1",
  "",
  "  push(value: T) {",
  "    this.values.length = this.index + 1",
  "    this.values.push(value)",
  "    this.index++",
  "  }",
  "}",
].join("\n")
const text = `Here:\n\n\`\`\`ts\n${source}\n\`\`\`\n\nKey points: single array plus a cursor.`

let mounted: Mounted | undefined

afterEach(() => {
  mounted?.dispose()
  mounted = undefined
})

test("a block whose message settles mid-block keeps its token renderer without a worker", async () => {
  const [value, setValue] = createSignal("")
  const [streaming, setStreaming] = createSignal(true)
  mounted = mountRich(() => <Markdown text={value()} streaming={streaming()} cacheKey="part" />)
  const host = mounted.host

  // A finished message keeps revealing its tail while it drains, so the block grows after the stream ended.
  for (let end = 1; end <= text.length; end += 9) {
    setValue(text.slice(0, end))
    if (end > 60) setStreaming(false)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  setValue(text)
  setStreaming(false)

  const code = await waitFor(() => {
    const element = host.querySelector('[data-markdown-key$=":code"] code')
    return element && element.children.length > 1 && element.textContent === source ? element : undefined
  }, 3000)
  const nodes = [...code.childNodes]
  expect(nodes.every((node) => node instanceof HTMLSpanElement && !node.classList.contains("line"))).toBe(true)
  expect(nodes.some((node) => node instanceof HTMLSpanElement && node.getAttribute("style"))).toBe(true)
  // The progressive highlighter adopts `pre > code[data-lang]` and replaces the block. A token block must never carry
  // it, or two renderers take turns on one element again.
  expect(code.hasAttribute("data-lang")).toBe(false)
})

test("a settled block that starts streaming again ends with one token renderer", async () => {
  const [value, setValue] = createSignal(text)
  const [streaming, setStreaming] = createSignal(false)
  mounted = mountRich(() => <Markdown text={value()} streaming={streaming()} cacheKey="history" />)
  const host = mounted.host

  // A loaded message renders as one Markdown block. Resuming the session streams the same code block as tokens.
  await waitFor(() => host.querySelector("pre.shiki code span.line"), 3000)
  setStreaming(true)
  for (let end = text.length; end <= text.length + 60; end += 6) {
    setValue(text.slice(0, end) + "\n\nNext paragraph.")
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  setStreaming(false)

  const block = await waitFor(() => host.querySelector('[data-markdown-key$=":code"]'), 3000)
  const code = block.querySelector("code")!
  expect(code.textContent).toBe(source)
  expect(host.querySelectorAll("pre")).toHaveLength(1)
  expect(host.querySelectorAll("code[data-lang]")).toHaveLength(0)
  expect(code.querySelector(".line")).toBeNull()
})

test("the in-process highlighter returns the token shape the renderer patches", async () => {
  const result = await highlightInProcess("const a = 1\nconst b = 2", "ts")
  expect(result.language).toBe("ts")
  expect(result.unstable).toEqual([])
  expect(result.generation).toBeGreaterThan(0)
  expect(result.stable.map((token) => token[0]).join("")).toBe("const a = 1\nconst b = 2")
  expect(result.stable.some((token) => token[1])).toBe(true)
})
