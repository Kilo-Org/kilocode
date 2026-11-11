import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { DiffViewerProvider, hasReactionComment } from "../src/diff/DiffViewerProvider"
import type { DiffSourceCatalog } from "../src/diff/sources/catalog"
import type { PanelContext } from "../src/diff/context"
import type { PRReviewCommentData, ReviewCommentEntry } from "../src/shared/review-comments"
import type { Manager } from "../src/server"
import type { PRStatus } from "../src/agent-manager/types"

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

// The provider's own message entry point and outgoing post, reached without a real webview panel.
type Internals = { onMessage(msg: Record<string, unknown>): boolean; post?: (message: unknown) => void }

function harness() {
  const contexts: PanelContext[] = []
  const sent: Array<[ReviewCommentEntry[], boolean]> = []
  const provider = new DiffViewerProvider(
    {
      context,
      server,
      directory: "/repo",
      catalog,
      onComments: (comments, autoSend) => sent.push([comments, autoSend]),
    },
    {
      sessionIdProvider: () => "sidebar",
      sessionDirectoryProvider: () => "/sidebar/repo",
    },
  )
  provider.openPanel = (ctx) => {
    contexts.push(ctx)
  }
  return { provider, contexts, sent, internals: provider as unknown as Internals }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

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
  it("opens a turn in its own scope", () => {
    const h = harness()
    h.provider.open({ sessionId: "session-1", turnId: "turn-1" })

    expect(h.contexts.at(0)).toMatchObject({
      sessionId: "session-1",
      initialSourceId: "turn:session-1:turn-1",
      hidePicker: true,
    })
  })

  it("sends comments to its sink when the command opened the panel", () => {
    const h = harness()
    const comment: ReviewCommentEntry = {
      id: "c1",
      file: "a.ts",
      side: "additions",
      line: 1,
      comment: "fix",
      selectedText: "",
    }
    h.provider.openFromCommand()
    h.internals.onMessage({ type: "diffViewer.sendComments", comments: [comment], autoSend: true })

    expect(h.sent).toEqual([[[comment], true]])
  })
})

describe("DiffViewerProvider reactions", () => {
  it("echoes the request project so the webview accepts the result", async () => {
    const h = harness()
    const posted: Record<string, unknown>[] = []
    h.internals.post = (message) => posted.push(message as Record<string, unknown>)

    h.internals.onMessage({
      type: "agentManager.commentReaction",
      projectId: "pr-token",
      commentId: "missing",
      reaction: "THUMBS_UP",
      add: true,
    })
    await tick()

    expect(posted.at(0)).toMatchObject({
      type: "agentManager.commentReactionResult",
      projectId: "pr-token",
      commentId: "missing",
      success: false,
    })
  })

  it("finds a reply as a reaction target", () => {
    const pr = {
      comments: { comments: [{ id: "root", replies: [{ id: "reply" }] }] },
    } as unknown as PRStatus

    expect(hasReactionComment(pr, "reply")).toBe(true)
    expect(hasReactionComment(pr, "root")).toBe(true)
    expect(hasReactionComment(pr, "other")).toBe(false)
  })
})
