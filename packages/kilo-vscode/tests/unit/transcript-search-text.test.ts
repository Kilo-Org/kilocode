import { describe, expect, it } from "bun:test"
import { rowSearchText } from "../../webview-ui/src/components/chat/transcript-search-text"
import type { TranscriptRow } from "../../webview-ui/src/context/transcript-rows"
import type { Part } from "../../webview-ui/src/types/messages"

const part = (value: Record<string, unknown>) => value as unknown as Part

const row = (type: "user" | "assistant", parts: Part[]) =>
  ({
    type,
    key: "row-1",
    turn: "turn-1",
    partial: false,
    queued: false,
    live: false,
    message: {},
    parts,
  }) as unknown as TranscriptRow

const reasoning = part({ id: "reasoning-1", type: "reasoning", text: "penguin reasoning" })
const tool = part({
  id: "tool-1",
  type: "tool",
  tool: "bash",
  state: { status: "completed", input: { command: "walrus" }, output: "walrus output", title: "Run" },
})
const file = part({ id: "file-1", type: "file", mime: "text/plain", filename: "narwhal.ts", url: "file:///narwhal.ts" })
const text = (id: string, value: string) => part({ id, type: "text", text: value })

describe("rowSearchText", () => {
  it("searches message text only and skips every non-message part", () => {
    const result = rowSearchText(row("assistant", [reasoning, text("text-1", "swallow helper"), tool, file]))
    expect(result.text).toBe("swallow helper")
    expect(result.ranges).toEqual([{ start: 0, end: 14, partId: "text-1" }])
  })

  it("joins multiple text parts and attributes a range to each", () => {
    const result = rowSearchText(row("assistant", [text("text-1", "alpha"), reasoning, text("text-2", "beta")]))
    expect(result.text).toBe("alpha\nbeta")
    expect(result.ranges).toEqual([
      { start: 0, end: 5, partId: "text-1" },
      { start: 6, end: 10, partId: "text-2" },
    ])
  })

  it("skips synthetic text parts", () => {
    const result = rowSearchText(
      row("assistant", [part({ id: "synthetic-1", type: "text", text: "hidden", synthetic: true })]),
    )
    expect(result.text).toBe("")
    expect(result.ranges).toEqual([])
  })

  it("strips hidden markdown link URLs from assistant text", () => {
    const result = rowSearchText(row("assistant", [text("text-1", "see [marked.tsx](src/marked.tsx) now")]))
    expect(result.text).toBe("see marked.tsx now")
    // Ranges must be measured against the stripped text, not the raw source.
    expect(result.ranges).toEqual([{ start: 0, end: 18, partId: "text-1" }])
  })

  it("keeps brackets in user text, which renders literally", () => {
    const result = rowSearchText(row("user", [text("text-1", "see [marked.tsx](src/marked.tsx) now")]))
    expect(result.text).toBe("see [marked.tsx](src/marked.tsx) now")
  })

  it("returns nothing for diff and error rows", () => {
    const diff = {
      type: "diff",
      key: "row-1",
      turn: "turn-1",
      partial: false,
      queued: false,
      live: false,
      message: {},
      diffs: [],
    }
    const error = {
      type: "error",
      key: "row-2",
      turn: "turn-1",
      partial: false,
      queued: false,
      live: false,
      message: {},
      error: {},
    }
    expect(rowSearchText(diff as unknown as TranscriptRow)).toEqual({ text: "", ranges: [] })
    expect(rowSearchText(error as unknown as TranscriptRow)).toEqual({ text: "", ranges: [] })
  })
})
