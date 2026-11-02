import { describe, expect, it } from "bun:test"
import { insertSpacedText } from "../webview-ui/src/v2/prompt-speech"

describe("insertSpacedText", () => {
  it("inserts at the end and at the cursor with spaces where needed", () => {
    expect(insertSpacedText("", "hello", 0, 0)).toEqual({ text: "hello", pos: 5 })
    expect(insertSpacedText("helloworld", "beautiful", 5, 5)).toEqual({ text: "hello beautiful world", pos: 16 })
    expect(insertSpacedText("hello world", "beautiful", 6, 6)).toEqual({ text: "hello beautiful world", pos: 16 })
  })

  it("replaces the selection and keeps surrounding whitespace", () => {
    expect(insertSpacedText("hello bad world", "beautiful", 6, 9)).toEqual({ text: "hello beautiful world", pos: 15 })
    expect(insertSpacedText("world", "hello", 0, 0)).toEqual({ text: "hello world", pos: 6 })
    expect(insertSpacedText("hello ", "world", 6, 6)).toEqual({ text: "hello world", pos: 11 })
  })
})
