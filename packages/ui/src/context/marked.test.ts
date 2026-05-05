// kilocode_change - new file
import { describe, expect, it } from "bun:test"
import { escapeWindowsPaths } from "./marked"

describe("escapeWindowsPaths", () => {
  it("escapes backslashes in Windows absolute paths", () => {
    expect(escapeWindowsPaths("C:\\Users\\user1\\.config\\kilo\\kilo.jsonc")).toBe(
      "C:\\\\Users\\\\user1\\\\.config\\\\kilo\\\\kilo.jsonc",
    )
  })

  it("handles lowercase drive letters", () => {
    expect(escapeWindowsPaths("c:\\Users\\user1\\.antigravity\\extensions\\kilo.exe")).toBe(
      "c:\\\\Users\\\\user1\\\\.antigravity\\\\extensions\\\\kilo.exe",
    )
  })

  it("handles multiple paths in one line", () => {
    expect(escapeWindowsPaths("See C:\\Users\\.config and D:\\data\\.env for details")).toBe(
      "See C:\\\\Users\\\\.config and D:\\\\data\\\\.env for details",
    )
  })

  it("preserves content inside backtick code spans", () => {
    const input = "`C:\\Users\\.config`"
    expect(escapeWindowsPaths(input)).toBe(input)
  })

  it("preserves content inside fenced code blocks", () => {
    const input = "```\nC:\\Users\\.config\n```"
    expect(escapeWindowsPaths(input)).toBe(input)
  })

  it("does not alter non-path text", () => {
    expect(escapeWindowsPaths("This is **bold** and *italic*")).toBe("This is **bold** and *italic*")
  })

  it("does not alter intentional markdown escapes", () => {
    expect(escapeWindowsPaths("Use \\*escaped stars\\*")).toBe("Use \\*escaped stars\\*")
  })

  it("does not alter non-path backslash-dot sequences", () => {
    expect(escapeWindowsPaths("\\.hidden")).toBe("\\.hidden")
  })

  it("handles mixed paths and code spans", () => {
    expect(escapeWindowsPaths("Mixed: C:\\Users\\.dir and `D:\\data\\.env` ok")).toBe(
      "Mixed: C:\\\\Users\\\\.dir and `D:\\data\\.env` ok",
    )
  })

  it("passes through text with no paths unchanged", () => {
    const input = "Just regular markdown with [links](http://example.com) and `code`"
    expect(escapeWindowsPaths(input)).toBe(input)
  })

  it("handles path at end of line", () => {
    expect(escapeWindowsPaths("Path: C:\\foo\\.bar")).toBe("Path: C:\\\\foo\\\\.bar")
  })

  it("preserves paths when rendered through marked", async () => {
    // This tests the end-to-end fix: Windows path -> escapeWindowsPaths -> marked.parse
    const { marked } = await import("marked")
    const input = "C:\\Users\\user1\\.config\\kilo\\kilo.jsonc"
    const result = marked.parse(escapeWindowsPaths(input)) as string
    expect(result.trim()).toBe("<p>C:\\Users\\user1\\.config\\kilo\\kilo.jsonc</p>")
  })

  it("preserves .antigravity path when rendered through marked", async () => {
    const { marked } = await import("marked")
    const input = "c:\\Users\\user1\\.antigravity\\extensions\\kilo.exe"
    const result = marked.parse(escapeWindowsPaths(input)) as string
    expect(result.trim()).toBe("<p>c:\\Users\\user1\\.antigravity\\extensions\\kilo.exe</p>")
  })
})
