import { describe, it, expect } from "bun:test"
import {
  finalizeChatSuggestion,
  buildChatPrefix,
} from "../../src/services/autocomplete/chat-autocomplete/chat-autocomplete-utils"

describe("finalizeChatSuggestion", () => {
  it("returns empty string for empty input", () => {
    expect(finalizeChatSuggestion("")).toBe("")
  })

  it("filters suggestions starting with // (JS comment)", () => {
    expect(finalizeChatSuggestion("// this is a comment")).toBe("")
  })

  it("filters suggestions starting with /* (block comment)", () => {
    expect(finalizeChatSuggestion("/* block */")).toBe("")
  })

  it("filters suggestions starting with * (JSDoc line)", () => {
    expect(finalizeChatSuggestion("* @param foo")).toBe("")
  })

  it("filters suggestions starting with # (shell/Python comment)", () => {
    expect(finalizeChatSuggestion("# python comment")).toBe("")
  })

  it("returns the suggestion as-is for normal text", () => {
    expect(finalizeChatSuggestion("hello world")).toBe("hello world")
  })

  it("truncates at first newline", () => {
    expect(finalizeChatSuggestion("first line\nsecond line")).toBe("first line")
  })

  it("trims trailing whitespace", () => {
    expect(finalizeChatSuggestion("hello   ")).toBe("hello")
  })

  it("truncates AND trims", () => {
    expect(finalizeChatSuggestion("first line   \nsecond")).toBe("first line")
  })

  it("handles single word without newline", () => {
    expect(finalizeChatSuggestion("world")).toBe("world")
  })
})

describe("buildChatPrefix", () => {
  it("includes user message without editor context", () => {
    const result = buildChatPrefix("fix this bug")
    expect(result).toContain("fix this bug")
    expect(result).toContain("User's message")
  })

  it("does not include editor header when no editors provided", () => {
    const result = buildChatPrefix("hello")
    expect(result).not.toContain("Code visible in editor")
  })

  it("includes editor context when editors provided", () => {
    const editors = [
      {
        filePath: "/workspace/src/foo.ts",
        languageId: "typescript",
        visibleRanges: [{ content: "const x = 1" }],
      },
    ]
    const result = buildChatPrefix("fix this", editors)
    expect(result).toContain("Code visible in editor")
    expect(result).toContain("foo.ts (typescript)")
    expect(result).toContain("const x = 1")
    expect(result).toContain("fix this")
  })

  it("includes multiple editors", () => {
    const editors = [
      { filePath: "/a.ts", languageId: "typescript", visibleRanges: [{ content: "code a" }] },
      { filePath: "/b.py", languageId: "python", visibleRanges: [{ content: "code b" }] },
    ]
    const result = buildChatPrefix("question", editors)
    expect(result).toContain("a.ts")
    expect(result).toContain("b.py")
    expect(result).toContain("code a")
    expect(result).toContain("code b")
  })

  it("uses last segment of file path as filename", () => {
    const editors = [{ filePath: "/deep/path/to/myfile.ts", languageId: "typescript", visibleRanges: [] }]
    const result = buildChatPrefix("q", editors)
    expect(result).toContain("myfile.ts")
    expect(result).not.toContain("deep/path")
  })

  it("handles empty editors array as if no context", () => {
    const result = buildChatPrefix("hi", [])
    expect(result).not.toContain("Code visible in editor")
    expect(result).toContain("hi")
  })
})
