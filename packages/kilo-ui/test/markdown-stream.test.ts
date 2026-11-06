import { describe, expect, it } from "bun:test"
import { project, stream, type Projection } from "../../kilo-ui-base/src/components/markdown-stream"

// A code-heavy answer with the constructs a streaming render must keep: code
// fences, tables, lists, links, nested markdown and an unterminated fence.
const answer = [
  "# Sorting tour\n\nIntro with a [link](https://example.com/docs) and `inline code`.\n\n",
  "| name | best | stable |\n| ---- | ---- | ------ |\n| quick | n log n | no |\n\n",
  "- bubble: simple\n- merge: stable\n  - recursive\n\n",
  "1. run the sample\n\n   ```js\n   const first = 1\n   ```\n\n2. compare the result\n\n",
  "```ts\nexport function mergeSort(values: number[]): number[] {\n  if (values.length < 2) return values\n  return merge(mergeSort(values.slice(0, 1)), values.slice(1))\n}\n```\n\n",
  "> Heap sort builds a max heap, then swaps the root to the end.\n\n",
  "```py\ndef heap_sort(values):\n    return sorted(values)\n```\n\n",
  "Final paragraph that keeps growing while the answer streams.\n\n",
  "~~~\nunclosed fence line one\nline two",
].join("")

function streamed(text: string, step: number) {
  let previous: Projection | undefined
  const frames: Projection[] = []
  for (let i = 0; i <= text.length; i += step) {
    previous = project(previous, text.slice(0, i), true)
    frames.push(previous)
  }
  const last = project(previous, text, true)
  frames.push(last)
  return { frames, settled: project(last, text, false) }
}

describe("project", () => {
  it("reuses the projection when the text length has not changed", () => {
    const { frames } = streamed(answer, 7)
    const current = frames.at(-1)!
    expect(project(current, current.text, true)).toBe(current)
  })

  it("only rebuilds the streaming tail", () => {
    const { frames } = streamed(answer, 5)
    for (let index = 1; index < frames.length; index++) {
      const previous = frames[index - 1]!
      const next = frames[index]!
      // The lexer window starts one block before the tail, so only that window
      // and the tail may be new objects.
      for (let block = 0; block < previous.blocks.length - 2; block++) {
        expect(next.blocks[block]).toBe(previous.blocks[block]!)
      }
    }
  })

  it("settles to the same blocks as one full lex pass", () => {
    const { frames, settled } = streamed(answer, 3)
    const live = frames.at(-1)!
    const full = stream(answer, true)
    // The incremental window must partition the text exactly like a full lex, so
    // every block renders the same content it would from one pass.
    expect(settled.blocks.map((block) => block.raw)).toEqual(full.map((block) => block.raw))
    expect(settled.blocks.filter((block) => block.mode === "code").map((block) => block.src)).toEqual(
      full.filter((block) => block.mode === "code").map((block) => block.src),
    )
    // Settling keeps the streamed layout and only flips live blocks to full.
    expect(settled.blocks.map((block) => block.raw)).toEqual(live.blocks.map((block) => block.raw))
    expect(settled.blocks.filter((block) => block.mode === "code").length).toBe(
      live.blocks.filter((block) => block.mode === "code").length,
    )
    for (const block of settled.blocks) {
      if (block.mode === "code") expect(block.src).not.toMatch(/^(?:```|~~~)/)
      else expect(block.src).toBe(block.raw)
    }
  })

  it("completes an unterminated code fence when the stream ends", () => {
    const { settled } = streamed(answer, 1)
    const code = settled.blocks.find((block) => block.mode === "code" && block.raw.startsWith("~~~"))
    expect(code?.complete).toBe(true)
    expect(code?.src).toBe("unclosed fence line one\nline two")
  })
})
