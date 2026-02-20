import { describe, it, expect } from "bun:test"
import { fileName, dirName, buildHighlightSegments } from "../../webview-ui/src/components/chat/prompt-input-utils"

describe("fileName", () => {
  it("extracts the last segment of a unix path", () => {
    expect(fileName("src/components/chat/PromptInput.tsx")).toBe("PromptInput.tsx")
  })

  it("extracts the last segment of a Windows path", () => {
    expect(fileName("src\\components\\chat\\PromptInput.tsx")).toBe("PromptInput.tsx")
  })

  it("returns the path itself when no separator present", () => {
    expect(fileName("README.md")).toBe("README.md")
  })

  it("returns the filename for a single directory segment", () => {
    expect(fileName("src/foo.ts")).toBe("foo.ts")
  })

  it("handles mixed separators", () => {
    expect(fileName("src\\components/chat/File.tsx")).toBe("File.tsx")
  })
})

describe("dirName", () => {
  it("returns empty string for a file with no directory", () => {
    expect(dirName("README.md")).toBe("")
  })

  it("returns the directory for a simple path", () => {
    expect(dirName("src/foo.ts")).toBe("src")
  })

  it("returns full directory for a short path", () => {
    expect(dirName("src/components/foo.ts")).toBe("src/components")
  })

  it("truncates long directories to last two segments", () => {
    const path = "packages/kilo-vscode/webview-ui/src/components/chat/foo.ts"
    const result = dirName(path)
    expect(result).toMatch(/^…\//)
    expect(result).toContain("components/chat")
  })

  it("does not truncate directories at exactly 30 chars", () => {
    const dir = "a".repeat(15) + "/" + "b".repeat(14)
    const result = dirName(`${dir}/file.ts`)
    expect(result).toBe(dir)
  })

  it("truncates directories longer than 30 chars", () => {
    const dir = "a".repeat(16) + "/" + "b".repeat(15)
    const result = dirName(`${dir}/file.ts`)
    expect(result.startsWith("…/")).toBe(true)
  })

  it("normalizes Windows backslashes before measuring length", () => {
    const result = dirName("src\\foo.ts")
    expect(result).toBe("src")
  })
})

describe("buildHighlightSegments", () => {
  it("returns single non-highlighted segment when paths set is empty", () => {
    const result = buildHighlightSegments("hello world", new Set())
    expect(result).toEqual([{ text: "hello world", highlight: false }])
  })

  it("returns single non-highlighted segment when no mention present", () => {
    const result = buildHighlightSegments("hello world", new Set(["foo.ts"]))
    expect(result).toEqual([{ text: "hello world", highlight: false }])
  })

  it("highlights a single mention token", () => {
    const result = buildHighlightSegments("@foo.ts", new Set(["foo.ts"]))
    expect(result).toEqual([{ text: "@foo.ts", highlight: true }])
  })

  it("splits text before and highlight token", () => {
    const result = buildHighlightSegments("see @foo.ts here", new Set(["foo.ts"]))
    expect(result).toEqual([
      { text: "see ", highlight: false },
      { text: "@foo.ts", highlight: true },
      { text: " here", highlight: false },
    ])
  })

  it("highlights multiple mentions in order", () => {
    const result = buildHighlightSegments("@a.ts and @b.ts done", new Set(["a.ts", "b.ts"]))
    expect(result).toEqual([
      { text: "@a.ts", highlight: true },
      { text: " and ", highlight: false },
      { text: "@b.ts", highlight: true },
      { text: " done", highlight: false },
    ])
  })

  it("picks the earliest mention when multiple paths could match", () => {
    const result = buildHighlightSegments("@b.ts then @a.ts", new Set(["a.ts", "b.ts"]))
    expect(result[0]).toEqual({ text: "@b.ts", highlight: true })
    expect(result[2]).toEqual({ text: "@a.ts", highlight: true })
  })

  it("handles back-to-back mentions with no separator", () => {
    const result = buildHighlightSegments("@a.ts@b.ts", new Set(["a.ts", "b.ts"]))
    const highlighted = result.filter((s) => s.highlight)
    expect(highlighted).toHaveLength(2)
  })

  it("returns empty array for empty string", () => {
    const result = buildHighlightSegments("", new Set(["foo.ts"]))
    expect(result).toEqual([])
  })

  it("does not partially match longer paths", () => {
    const result = buildHighlightSegments("@foo.ts", new Set(["foo.tsx"]))
    expect(result).toEqual([{ text: "@foo.ts", highlight: false }])
  })
})
