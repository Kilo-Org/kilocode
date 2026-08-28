import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { DiffViewerProvider } from "../../src/diff/DiffViewerProvider"
import type { PRReviewCommentData } from "../../src/shared/review-comments"
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

  it("hides the scope picker only for turn reviews, not an explicit workspace source", () => {
    const provider = new DiffViewerProvider({} as vscode.Uri, {} as never, {} as never)
    const contexts: PanelContext[] = []
    provider.openPanel = (ctx) => contexts.push(ctx)
    provider.openFromCommand({ sessionId: "origin", initialSourceId: "workspace" })
    provider.openFromCommand({ sessionId: "origin", turnId: "turn-one" })
    expect(contexts[0]).toMatchObject({ initialSourceId: "workspace", hidePicker: false })
    expect(contexts[1]?.hidePicker).toBe(true)
    provider.dispose()
  })

  it("keeps PR navigation metadata and routes each opening callback only once", () => {
    const provider = new DiffViewerProvider({} as vscode.Uri, {} as never, {} as never, {
      sessionIdProvider: () => "sidebar",
      sessionDirectoryProvider: () => "/sidebar/repo",
    })
    const contexts: PanelContext[] = []
    const targets: Array<((comments: unknown[], autoSend: boolean) => void) | undefined> = []
    provider.openPanel = (ctx, target) => {
      contexts.push(ctx)
      targets.push(target)
    }
    const comment: PRReviewCommentData = {
      id: "thread-1",
      origin: "pr",
      author: "reviewer",
      body: "Use the current line.",
      file: "src/app.ts",
      line: 9,
    }
    const opening = () => undefined

    provider.openFromCommand({
      sessionId: "origin",
      directory: "/origin/repo",
      file: "src/app.ts",
      comment,
      onComments: opening,
      beside: true,
    })
    provider.openFromCommand({ sessionId: "origin", directory: "/origin/repo" })

    expect(contexts[0]).toMatchObject({
      sessionId: "origin",
      dir: "/origin/repo",
      initialFile: "src/app.ts",
      comment,
      beside: true,
      initialMarkdown: false,
      initialSourceId: "workspace",
      hidePicker: false,
    })
    expect(targets[0]).toBe(opening)
    expect(targets[1]).toBeUndefined()
    provider.dispose()
  })
})
