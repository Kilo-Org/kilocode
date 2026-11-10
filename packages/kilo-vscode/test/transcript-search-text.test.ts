import { describe, expect, it } from "bun:test"
import type { SessionMessageAssistant, SessionMessageUser } from "@opencode/client"
import type { TranscriptRow } from "../webview-ui/src/v2/transcript"
import { rowSearchText } from "../webview-ui/src/v2/transcript-search-text"

const text = (value: string) => ({ type: "text", text: value }) as SessionMessageAssistant["content"][number]

const assistant = (parts: SessionMessageAssistant["content"], start = 0) =>
  ({
    type: "assistant",
    key: "row-1",
    turn: "turn-1",
    message: { id: "message-1", type: "assistant", content: parts },
    start,
    parts,
  }) as unknown as TranscriptRow

const user = (value: string) =>
  ({
    type: "user",
    key: "row-1",
    turn: "turn-1",
    message: { id: "message-1", type: "user", text: value, time: { created: 1 } } as SessionMessageUser,
  }) as unknown as TranscriptRow

describe("rowSearchText", () => {
  it("searches message text only and skips every non-message part", () => {
    const result = rowSearchText(
      assistant([
        { type: "reasoning", text: "penguin reasoning" },
        text("swallow helper"),
        {
          type: "tool",
          id: "tool-1",
          name: "bash",
          time: { created: 1 },
          state: { status: "completed", input: { command: "walrus" }, content: [{ type: "text", text: "walrus" }] },
        },
      ]),
    )
    expect(result.text).toBe("swallow helper")
    expect(result.ranges).toEqual([{ start: 0, end: 14, partId: "message-1:1" }])
  })

  it("joins multiple text parts and attributes a range to each", () => {
    const result = rowSearchText(
      assistant([text("alpha"), { type: "reasoning", text: "hidden" }, text("beta")]),
    )
    expect(result.text).toBe("alpha\nbeta")
    expect(result.ranges).toEqual([
      { start: 0, end: 5, partId: "message-1:0" },
      { start: 6, end: 10, partId: "message-1:2" },
    ])
  })

  it("uses the absolute part index of the rendered chunk for the part id", () => {
    const result = rowSearchText(assistant([text("later")], 8))
    expect(result.ranges).toEqual([{ start: 0, end: 5, partId: "message-1:8" }])
  })

  it("strips hidden markdown link URLs from assistant text", () => {
    const result = rowSearchText(assistant([text("see [marked.tsx](src/marked.tsx) now")]))
    expect(result.text).toBe("see marked.tsx now")
    // Ranges must be measured against the stripped text, not the raw source.
    expect(result.ranges).toEqual([{ start: 0, end: 18, partId: "message-1:0" }])
  })

  it("keeps brackets in user text, which renders literally", () => {
    expect(rowSearchText(user("see [marked.tsx](src/marked.tsx) now"))).toEqual({
      text: "see [marked.tsx](src/marked.tsx) now",
      ranges: [],
    })
  })

  it("returns nothing for error rows", () => {
    const error = {
      type: "error",
      key: "row-2",
      turn: "turn-1",
      message: { id: "message-2", type: "idle" },
      error: {},
    }
    expect(rowSearchText(error as unknown as TranscriptRow)).toEqual({ text: "", ranges: [] })
  })
})
