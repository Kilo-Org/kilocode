import { afterEach, describe, expect, it } from "bun:test"
import { window } from "vscode"
import { pathToFileURL } from "node:url"
import { selectionAttachment, terminalAttachment } from "../src/services/code-actions/attachments"
import { getEditorContext, type EditorContext } from "../src/services/code-actions/editor-utils"

const original = { editor: window.activeTextEditor }

function decode(uri: string) {
  const prefix = "data:text/plain;base64,"
  expect(uri.startsWith(prefix)).toBe(true)
  return Buffer.from(uri.slice(prefix.length), "base64").toString("utf8")
}

function context(overrides: Partial<EditorContext> = {}): EditorContext {
  return {
    filePath: "src/file.ts",
    selectedText: "const value = 1",
    startLine: 3,
    endLine: 5,
    diagnostics: [],
    source: "file:///repo/src/file.ts",
    ...overrides,
  }
}

afterEach(() => {
  window.activeTextEditor = original.editor
})

describe("selectionAttachment", () => {
  it("captures the selection as a UTF-8 data URL", () => {
    const attachment = selectionAttachment(context({ selectedText: "const cafe = 'café 你好'" }))

    expect(attachment.kind).toBe("selection")
    expect(decode(attachment.uri)).toBe("const cafe = 'café 你好'")
    expect(typeof attachment.id).toBe("string")
    expect(attachment.id).not.toHaveLength(0)
  })

  it("names a multi-line range and describes the workspace path", () => {
    const attachment = selectionAttachment(context())

    expect(attachment.name).toBe("file.ts:3-5")
    expect(attachment.description).toBe("src/file.ts, lines 3-5")
    expect(attachment.path).toBe("src/file.ts")
    expect(attachment.line).toBe(3)
  })

  it("names a single line once", () => {
    const attachment = selectionAttachment(context({ startLine: 7, endLine: 7 }))

    expect(attachment.name).toBe("file.ts:7")
    expect(attachment.description).toBe("src/file.ts, lines 7-7")
    expect(attachment.line).toBe(7)
  })

  it("keeps the source file URI of a saved document", () => {
    const attachment = selectionAttachment(context())

    expect(attachment.source).toBe("file:///repo/src/file.ts")
  })

  it("omits the source for a document that is not on disk", () => {
    window.activeTextEditor = {
      selection: { isEmpty: false, start: { line: 0 }, end: { line: 0 } },
      document: {
        uri: { scheme: "untitled", fsPath: "/repo/Untitled-1" },
        getText: () => "draft",
      },
    } as unknown as typeof window.activeTextEditor

    const ctx = getEditorContext()

    expect(ctx?.source).toBeUndefined()
    expect(selectionAttachment(ctx!).source).toBeUndefined()
  })

  it("builds a file URL for a saved document", () => {
    window.activeTextEditor = {
      selection: { isEmpty: false, start: { line: 2 }, end: { line: 2 } },
      document: {
        uri: { scheme: "file", fsPath: "/repo/src/file.ts" },
        getText: () => "const value = 1",
      },
    } as unknown as typeof window.activeTextEditor

    expect(getEditorContext()?.source).toBe(pathToFileURL("/repo/src/file.ts").href)
  })
})

describe("terminalAttachment", () => {
  it("carries the terminal output as a UTF-8 data URL", () => {
    const attachment = terminalAttachment({ content: "git status\nprüfen", truncated: false })

    expect(attachment.kind).toBe("terminal")
    expect(attachment.name).toBe("Terminal output")
    expect(decode(attachment.uri)).toBe("git status\nprüfen")
    expect(attachment.description).toBe("Terminal output")
  })

  it("notes truncation", () => {
    const attachment = terminalAttachment({ content: "first\nlast", truncated: true })

    expect(attachment.description).toBe("Terminal output, truncated")
  })
})
