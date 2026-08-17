import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { DiffViewerProvider } from "../../src/diff/DiffViewerProvider"
import type { PanelContext } from "../../src/diff/types"

describe("DiffViewerProvider.openFromCommand", () => {
  it("uses the invoking provider directory even when it is explicitly unavailable", () => {
    const provider = new DiffViewerProvider({} as vscode.Uri, {} as never, {} as never, {
      sessionIdProvider: () => "sidebar",
      sessionDirectoryProvider: () => "/sidebar/repo",
    })
    const contexts: PanelContext[] = []
    provider.openPanel = (ctx) => contexts.push(ctx)

    provider.openFromCommand({ sessionId: "agent-manager", directory: "/agent/repo" })
    provider.openFromCommand({ sessionId: "editor-tab", directory: undefined })
    provider.openFromCommand()

    expect(contexts.map((ctx) => ctx.dir)).toEqual(["/agent/repo", undefined, "/sidebar/repo"])
    provider.dispose()
  })
})
