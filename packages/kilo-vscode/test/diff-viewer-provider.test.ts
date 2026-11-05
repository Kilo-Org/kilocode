import { describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import { DiffViewerProvider } from "../src/diff/DiffViewerProvider"
import type { DiffSourceCatalog } from "../src/diff/sources/catalog"
import type { PanelContext } from "../src/diff/context"
import type { PRReviewCommentData, ReviewCommentEntry } from "../src/shared/review-comments"
import type { Manager } from "../src/server"

const catalog = {
  defaultSourceId: () => "workspace",
  listAvailable: () => [],
  build: () => {
    throw new Error("not used")
  },
  listWorkspaceBranches: async () => undefined,
  dispose: () => undefined,
} as unknown as DiffSourceCatalog

const context = {
  extensionUri: vscode.Uri.file("/ext"),
  extensionPath: "/ext",
  globalStorageUri: vscode.Uri.file("/storage"),
  extension: { packageJSON: { version: "test" } },
} as unknown as vscode.ExtensionContext

const server = { get: async () => ({ url: "http://127.0.0.1:1", authorization: "test" }) } as unknown as Manager

function harness() {
  const contexts: PanelContext[] = []
  const targets: Array<((comments: ReviewCommentEntry[], autoSend: boolean) => void) | undefined> = []
  const provider = new DiffViewerProvider(
    { context, server, directory: "/repo", catalog },
    {
      sessionIdProvider: () => "sidebar",
      sessionDirectoryProvider: () => "/sidebar/repo",
    },
  )
  const open = provider.openPanel.bind(provider)
  provider.openPanel = (ctx, target) => {
    contexts.push(ctx)
    targets.push(target)
  }
  return { provider, contexts, targets, open }
}

describe("DiffViewerProvider.openFromCommand", () => {
  it("resolves the opening session directory, then the sidebar fallback", () => {
    const h = harness()
    h.provider.openFromCommand({ sessionId: "agent-manager", directory: "/agent/repo" })
    h.provider.openFromCommand({ sessionId: "editor-tab", directory: undefined })
    h.provider.openFromCommand()

    expect(h.contexts.map((ctx) => ctx.dir)).toEqual(["/agent/repo", undefined, "/sidebar/repo"])
    expect(h.contexts.map((ctx) => ctx.sessionId)).toEqual(["agent-manager", "editor-tab", "sidebar"])
    expect(h.contexts.at(1)?.workspaceRoot).toBe("/repo")
  })

  it("hides the scope picker only for a turn review", () => {
    const h = harness()
    h.provider.openFromCommand({ sessionId: "origin", initialSourceId: "workspace" })
    h.provider.openFromCommand({ sessionId: "origin", turnId: "turn-one" })

    expect(h.contexts.at(0)).toMatchObject({ initialSourceId: "workspace", hidePicker: false })
    expect(h.contexts.at(1)).toMatchObject({ initialSourceId: "turn:origin:turn-one", hidePicker: true })
  })

  it("carries PR comment state into the panel context", () => {
    const h = harness()
    const comment: PRReviewCommentData = {
      id: "thread",
      origin: "pr",
      author: "alice",
      body: "snapshot",
      file: "old.ts",
      line: 7,
    }
    h.provider.openFromCommand({
      sessionId: "origin",
      directory: "/origin/repo",
      file: comment.file,
      comment,
      beside: true,
    })

    expect(h.contexts.at(0)).toMatchObject({
      sessionId: "origin",
      dir: "/origin/repo",
      initialFile: "old.ts",
      beside: true,
      initialMarkdown: false,
      initialSourceId: "workspace",
      hidePicker: false,
    })
  })
})

describe("DiffViewerProvider ChangesTab contract", () => {
  it("opens with the sidebar handler as the comment target", () => {
    const h = harness()
    const onComments = mock((_comments: ReviewCommentEntry[], _autoSend: boolean) => undefined)
    h.provider.open({ sessionId: "session-1", turnId: "turn-1", onComments })

    expect(h.contexts.at(0)).toMatchObject({
      sessionId: "session-1",
      initialSourceId: "turn:session-1:turn-1",
      hidePicker: true,
    })
    expect(h.targets.at(0)).toBe(onComments)
  })
})
