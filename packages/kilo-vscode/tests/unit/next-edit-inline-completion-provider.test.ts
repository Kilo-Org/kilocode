import { describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import type { KiloConnectionService } from "../../src/services/cli-backend"
import {
  NextEditInlineCompletionProvider,
  type NextEditProviderDeps,
} from "../../src/services/autocomplete/next-edit/NextEditInlineCompletionProvider"
import type { NextEditSuggestionManager } from "../../src/services/autocomplete/next-edit/NextEditSuggestionManager"

type Subject = {
  toCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    suggestion: {
      replacement: string
      editableRegionStartLine: number
      editableRegionEndLine: number
      latencyMs: number
    },
  ): vscode.InlineCompletionItem[] | undefined
}

function doc(text: string): vscode.TextDocument {
  const lines = text.split("\n")
  return {
    lineCount: lines.length,
    lineAt: (line: number) => ({
      text: lines[line],
      range: { end: new vscode.Position(line, lines[line].length) },
    }),
    getText: () => text,
    uri: { fsPath: "/workspace/test.ts", scheme: "file" },
  } as unknown as vscode.TextDocument
}

describe("NextEditInlineCompletionProvider", () => {
  it("does not send a document when the access policy is missing at runtime", async () => {
    const connection = { getClientAsync: mock() }
    const provider = new NextEditInlineCompletionProvider({
      connectionService: connection,
    } as unknown as NextEditProviderDeps)

    const out = await provider.provideInlineCompletionItems(
      doc("const value = 1"),
      new vscode.Position(0, 0),
      {} as vscode.InlineCompletionContext,
      {} as vscode.CancellationToken,
    )

    expect(out).toBeUndefined()
    expect(connection.getClientAsync).not.toHaveBeenCalled()
    provider.dispose()
  })

  it("does not send a document when the access policy fails", async () => {
    const connection = { getClientAsync: mock() }
    const provider = new NextEditInlineCompletionProvider({
      connectionService: connection as unknown as KiloConnectionService,
      isFileAllowed: async () => Promise.reject(new Error("unavailable")),
    })

    const out = await provider.provideInlineCompletionItems(
      doc("const value = 1"),
      new vscode.Position(0, 0),
      {} as vscode.InlineCompletionContext,
      {} as vscode.CancellationToken,
    )

    expect(out).toBeUndefined()
    expect(connection.getClientAsync).not.toHaveBeenCalled()
    provider.dispose()
  })

  it("stashes same-line rewrites before the cursor for decorated acceptance", () => {
    const mgr = { clear: mock(), setPending: mock() }
    const provider = new NextEditInlineCompletionProvider({
      connectionService: {} as KiloConnectionService,
      isFileAllowed: async () => true,
      suggestionManager: mgr as unknown as NextEditSuggestionManager,
    })
    const text = "const oldName = make()"
    const document = {
      lineCount: 1,
      lineAt: () => ({ text, range: { end: new vscode.Position(0, text.length) } }),
      getText: () => text,
    } as unknown as vscode.TextDocument

    const out = (provider as unknown as Subject).toCompletionItems(document, new vscode.Position(0, 13), {
      replacement: "const newName = make()",
      editableRegionStartLine: 0,
      editableRegionEndLine: 0,
      latencyMs: 1,
    })

    expect(out).toBeUndefined()
    expect(mgr.setPending).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "replace", replacement: "const newName = make()" }),
    )
    provider.dispose()
  })

  it("stashes complete-line deletion intent for acceptance", () => {
    const mgr = { clear: mock(), setPending: mock() }
    const provider = new NextEditInlineCompletionProvider({
      connectionService: {} as KiloConnectionService,
      isFileAllowed: async () => true,
      suggestionManager: mgr as unknown as NextEditSuggestionManager,
    })

    const out = (provider as unknown as Subject).toCompletionItems(
      doc("before\nremove\nafter"),
      new vscode.Position(1, 0),
      {
        replacement: "before\nafter",
        editableRegionStartLine: 0,
        editableRegionEndLine: 2,
        latencyMs: 1,
      },
    )

    expect(out).toBeUndefined()
    expect(mgr.setPending).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "replace", replacement: "", removesLines: true }),
    )
    provider.dispose()
  })

  it("does not classify a blank-line rewrite as deletion", () => {
    const mgr = { clear: mock(), setPending: mock() }
    const provider = new NextEditInlineCompletionProvider({
      connectionService: {} as KiloConnectionService,
      isFileAllowed: async () => true,
      suggestionManager: mgr as unknown as NextEditSuggestionManager,
    })

    const out = (provider as unknown as Subject).toCompletionItems(
      doc("before\nremove\nafter"),
      new vscode.Position(0, 0),
      {
        replacement: "before\n\nafter",
        editableRegionStartLine: 0,
        editableRegionEndLine: 2,
        latencyMs: 1,
      },
    )

    expect(out).toBeUndefined()
    expect(mgr.setPending).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "replace", replacement: "", removesLines: false }),
    )
    provider.dispose()
  })
})
