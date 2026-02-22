import { describe, expect, it } from "bun:test"
import { editorContextUrl } from "../../src/editor-context"

function createEditor(input: {
  uri: string
  isEmpty: boolean
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}) {
  return {
    document: {
      uri: {
        toString: () => input.uri,
      },
    },
    selection: {
      isEmpty: input.isEmpty,
      start: { line: input.startLine, character: input.startChar },
      end: { line: input.endLine, character: input.endChar },
    },
  }
}

describe("editorContextUrl", () => {
  it("returns original URL when selection is empty", () => {
    const editor = createEditor({
      uri: "file:///workspace/a.ts",
      isEmpty: true,
      startLine: 4,
      startChar: 2,
      endLine: 4,
      endChar: 2,
    })

    expect(editorContextUrl(editor)).toBe("file:///workspace/a.ts")
  })

  it("adds start/end lines for normal multi-line selection", () => {
    const editor = createEditor({
      uri: "file:///workspace/a.ts",
      isEmpty: false,
      startLine: 2,
      startChar: 1,
      endLine: 5,
      endChar: 8,
    })

    expect(editorContextUrl(editor)).toBe("file:///workspace/a.ts?start=3&end=6")
  })

  it("normalizes reversed selection direction", () => {
    const editor = createEditor({
      uri: "file:///workspace/a.ts",
      isEmpty: false,
      startLine: 9,
      startChar: 3,
      endLine: 6,
      endChar: 1,
    })

    expect(editorContextUrl(editor)).toBe("file:///workspace/a.ts?start=7&end=10")
  })

  it("avoids over-including trailing line when selection ends at column zero", () => {
    const editor = createEditor({
      uri: "file:///workspace/a.ts",
      isEmpty: false,
      startLine: 2,
      startChar: 5,
      endLine: 6,
      endChar: 0,
    })

    expect(editorContextUrl(editor)).toBe("file:///workspace/a.ts?start=3&end=6")
  })
})
