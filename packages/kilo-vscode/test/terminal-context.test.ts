import { describe, expect, it } from "bun:test"
import {
  TERMINAL_OUTPUT_CHARACTER_LIMIT,
  TERMINAL_OUTPUT_LINE_LIMIT,
  truncateTerminalOutput,
} from "../src/services/terminal/truncate"

describe("truncateTerminalOutput", () => {
  it("keeps short output unchanged", () => {
    expect(truncateTerminalOutput("one\ntwo")).toEqual({ content: "one\ntwo", truncated: false })
  })

  it("keeps the head and tail of long content by characters", () => {
    const content = `${"a".repeat(50)}${"b".repeat(50)}`
    const result = truncateTerminalOutput(content, { characterLimit: 40 })

    expect(result.truncated).toBe(true)
    expect(result.content).toContain("[...60 characters omitted...]")
    expect(result.content.startsWith("a".repeat(8))).toBe(true)
    expect(result.content.endsWith("b".repeat(32))).toBe(true)
  })

  it("keeps the head and tail of long content by lines", () => {
    const content = Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n")
    const result = truncateTerminalOutput(content, { lineLimit: 10 })

    expect(result.truncated).toBe(true)
    expect(result.content).toContain("[...2 lines omitted...]")
    expect(result.content.startsWith("line 0\nline 1")).toBe(true)
    expect(result.content.endsWith("line 10\nline 11")).toBe(true)
  })

  it("does not truncate at the default limits", () => {
    const content = Array.from({ length: TERMINAL_OUTPUT_LINE_LIMIT }, (_, index) => `${index}`).join("\n")

    expect(truncateTerminalOutput(content)).toEqual({ content, truncated: false })
    expect(TERMINAL_OUTPUT_CHARACTER_LIMIT).toBeGreaterThan(0)
  })

  it("disables a limit with zero", () => {
    const content = Array.from({ length: 20 }, (_, index) => `${index}`).join("\n")

    expect(truncateTerminalOutput(content, { lineLimit: 0, characterLimit: 0 })).toEqual({
      content,
      truncated: false,
    })
  })
})
