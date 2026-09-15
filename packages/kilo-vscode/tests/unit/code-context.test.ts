import { describe, expect, it } from "bun:test"
import {
  codeContextLabel,
  formatCodeContext,
  formatCodeContexts,
  mergeCodeContexts,
  type CodeContext,
} from "../../src/shared/code-context"
import { createPrompt } from "../../src/services/code-actions/support-prompt"

function context(overrides: Partial<CodeContext> = {}): CodeContext {
  return {
    id: "1",
    filePath: "tests/unit/services/test_subchannel_sharing.py",
    startLine: 271,
    endLine: 277,
    text: "writer_count.return_value = 2",
    ...overrides,
  }
}

describe("codeContextLabel", () => {
  it("uses the base name with the selected line range", () => {
    expect(codeContextLabel(context())).toBe("test_subchannel_sharing.py:271-277")
  })

  it("handles windows separators and empty file names", () => {
    expect(codeContextLabel(context({ filePath: "src\\app\\main.ts" }))).toBe("main.ts:271-277")
    expect(codeContextLabel(context({ filePath: "" }))).toBe(":271-277")
  })
})

describe("formatCodeContext", () => {
  it("matches the legacy editor prompt shape", () => {
    const value = context()
    expect(formatCodeContext(value)).toBe(
      createPrompt("ADD_TO_CONTEXT", {
        filePath: value.filePath,
        startLine: String(value.startLine),
        endLine: String(value.endLine),
        selectedText: value.text,
      }),
    )
  })
})

describe("formatCodeContexts", () => {
  it("joins multiple selections with a blank line", () => {
    const first = context()
    const second = context({ id: "2", filePath: "src/file.ts", startLine: 3, endLine: 5 })
    expect(formatCodeContexts([first, second])).toBe(`${formatCodeContext(first)}\n\n${formatCodeContext(second)}`)
  })
})

describe("mergeCodeContexts", () => {
  it("ignores duplicates and keeps distinct selections", () => {
    const first = context()
    const duplicate = context({ id: "other" })
    const other = context({ id: "2", startLine: 300, endLine: 305 })
    expect(mergeCodeContexts([first], [duplicate])).toEqual([first])
    expect(mergeCodeContexts([first], [other])).toEqual([first, other])
  })
})
