import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as vscode from "vscode"
import { openFileInEditor } from "../../src/review-utils"

const execute = spyOn(vscode.commands, "executeCommand")

afterEach(() => {
  execute.mockClear()
})

describe("openFileInEditor", () => {
  it("delegates to vscode.open so custom image editors can handle the file", () => {
    openFileInEditor("/repo/assets/banner.png", undefined, undefined, vscode.ViewColumn.One)

    expect(execute).toHaveBeenCalledTimes(1)
    const [command, uri, options] = execute.mock.calls[0]!
    expect(command).toBe("vscode.open")
    expect((uri as vscode.Uri).fsPath).toBe("/repo/assets/banner.png")
    expect(options).toEqual({ viewColumn: vscode.ViewColumn.One, preview: true })
  })

  it("preserves line and column navigation for text editors", () => {
    openFileInEditor("/repo/src/app.ts", 7, 3, vscode.ViewColumn.One)

    const options = execute.mock.calls[0]?.[2] as vscode.TextDocumentShowOptions
    expect(options.selection?.start.line).toBe(6)
    expect(options.selection?.start.character).toBe(2)
  })
})
