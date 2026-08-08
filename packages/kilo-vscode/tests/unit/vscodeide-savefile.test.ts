import { describe, it, expect, vi } from "bun:test"
import { VsCodeIde } from "../../src/services/autocomplete/continuedev/core/vscode-test-harness/src/VSCodeIde"
import * as vscode from "vscode"

describe("VsCodeIde", () => {
  it("awaits save on visible editor matching the URI", async () => {
    const saveMock = vi.fn().mockResolvedValue(true)
    const editor = {
      document: {
        uri: { toString: () => "file:///test.ts" },
        save: saveMock,
      },
    }

    vscode.window.visibleTextEditors = [editor]

    const ide = new VsCodeIde({} as any)
    await ide.saveFile("file:///test.ts")

    expect(saveMock).toHaveBeenCalledTimes(1)
  })

  it("completes without error when no visible editor matches", async () => {
    vscode.window.visibleTextEditors = []

    const ide = new VsCodeIde({} as any)
    await expect(ide.saveFile("file:///nonexistent.ts")).resolves.toBeUndefined()
  })

  it("returns false when the file does not exist", async () => {
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValueOnce(null)

    const ide = new VsCodeIde({} as any)
    await expect(ide.fileExists("/missing.ts")).resolves.toBe(false)
  })

  it("returns true when the file exists", async () => {
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValueOnce({} as any)

    const ide = new VsCodeIde({} as any)
    await expect(ide.fileExists("/exists.ts")).resolves.toBe(true)
  })
})
