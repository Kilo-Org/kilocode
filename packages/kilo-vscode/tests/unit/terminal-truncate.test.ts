import { describe, expect, it } from "bun:test"
import { truncateTerminalOutput } from "../../src/services/terminal/truncate"

describe("truncateTerminalOutput", () => {
  it("returns content within limits", () => {
    expect(truncateTerminalOutput("one\ntwo", { lineLimit: 5, characterLimit: 100 })).toEqual({
      content: "one\ntwo",
      truncated: false,
    })
  })

  it("truncates by character limit first", () => {
    const result = truncateTerminalOutput("a".repeat(20), { lineLimit: 1, characterLimit: 10 })
    expect(result.truncated).toBe(true)
    expect(result.content).toContain("[...10 characters omitted...]")
  })

  it("truncates by line limit", () => {
    const result = truncateTerminalOutput("1\n2\n3\n4\n5", { lineLimit: 3, characterLimit: 100 })
    expect(result.truncated).toBe(true)
    expect(result.content).toContain("[...2 lines omitted...]")
    expect(result.content.endsWith("3\n4\n5")).toBe(true)
  })
})
