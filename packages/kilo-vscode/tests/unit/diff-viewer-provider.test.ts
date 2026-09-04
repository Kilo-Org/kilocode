import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as vscode from "vscode"
import { DiffViewerProvider } from "../../src/diff/DiffViewerProvider"
import type { DiffPRPoller, DiffPRPollerOptions } from "../../src/diff/pr-poller"
import type { PRComment, PRStatus } from "../../src/agent-manager/types"
import type { PRReviewCommentData } from "../../src/shared/review-comments"
import type { PanelContext } from "../../src/diff/types"

const original = { panel: vscode.window.createWebviewPanel, clipboard: vscode.env.clipboard }
const providers: DiffViewerProvider[] = []
const review: PRReviewCommentData = {
  id: "thread-id",
  origin: "pr",
  author: "alice",
  body: "snapshot",
  file: "old.ts",
  line: 7,
}

afterEach(() => {
  for (const provider of providers.splice(0)) provider.dispose()
  Object.assign(vscode.window, { createWebviewPanel: original.panel })
  Object.assign(vscode.env, { clipboard: original.clipboard })
  mock.restore()
})

function event<T>() {
  let listener: ((value: T) => void) | undefined
  return {
    on(handler: (value: T) => void) {
      listener = handler
      return new vscode.Disposable(() => {
        if (listener === handler) listener = undefined
      })
    },
    fire: (value: T) => listener?.(value),
  }
}

function comment(overrides: Partial<PRComment> = {}): PRComment {
  return {
    id: "comment-id",
    threadId: review.id,
    author: review.author,
    body: "Please update this.",
    file: "src/app.ts",
    side: "additions",
    line: 7,
    resolved: false,
    outdated: false,
    ...overrides,
  }
}

function status(comments?: PRComment[]): PRStatus {
  return {
    number: 42,
    title: "Change",
    url: "https://github.com/example/repo/pull/42",
    state: "open",
    review: null,
    checks: { status: "none", total: 0, passed: 0, failed: 0, pending: 0, checks: [] },
    reviewers: [],
    ...(comments ? { comments: { total: comments.length, unresolved: comments.length, comments } } : {}),
    additions: 1,
    deletions: 0,
    files: 1,
  }
}

function harness() {
  const posted: Array<{ type: string; id?: string; file?: string; comments?: PRComment[] }> = []
  const received = event<unknown>()
  const disposed = event<void>()
  const changed = event<{ webviewPanel: { visible: boolean } }>()
  const panel = {
    webview: {
      cspSource: "",
      html: "",
      asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: async (message: (typeof posted)[number]) => {
        posted.push(message)
        return true
      },
      onDidReceiveMessage: received.on,
    },
    visible: true,
    viewColumn: vscode.ViewColumn.One,
    reveal: () => undefined,
    dispose: () => disposed.fire(),
    onDidDispose: disposed.on,
    onDidChangeViewState: changed.on,
  }
  vscode.window.createWebviewPanel = () => panel as unknown as vscode.WebviewPanel
  const pollers: Array<DiffPRPollerOptions & DiffPRPoller> = []
  const provider = new DiffViewerProvider(
    {} as vscode.Uri,
    { getServerInfo: () => undefined } as never,
    { defaultSourceId: () => undefined, listAvailable: () => [] } as never,
    {
      sessionIdProvider: () => "sidebar",
      sessionDirectoryProvider: () => "/sidebar/repo",
      createPRPoller: (opts) => {
        const poller = {
          ...opts,
          setActiveWorktreeId: mock(() => undefined),
          setEnabled: mock(() => undefined),
          setVisible: mock(() => undefined),
          stop: mock(() => undefined),
        }
        pollers.push(poller)
        return poller
      },
    },
  )
  providers.push(provider)
  const ctx = { workspaceRoot: undefined, sessionId: "session-1", dir: "/repo" }
  provider.openPanel(ctx)
  const contexts: PanelContext[] = []
  const open = provider.openPanel.bind(provider)
  provider.openPanel = (ctx, target) => {
    contexts.push(ctx)
    open(ctx, target)
  }
  return {
    provider,
    ctx,
    contexts,
    panel,
    posted,
    pollers,
    received,
    changed,
    messages: (type: string) => posted.filter((message) => message.type === type),
    comments: () => posted.findLast((message) => message.type === "diffViewer.prComments")?.comments,
  }
}

describe("DiffViewerProvider.openFromCommand", () => {
  it("uses the invoking provider directory even when it is explicitly unavailable", () => {
    const h = harness()
    h.provider.openFromCommand({ sessionId: "agent-manager", directory: "/agent/repo" })
    h.provider.openFromCommand({ sessionId: "editor-tab", directory: undefined })
    h.provider.openFromCommand()

    expect(h.contexts.map((ctx) => ctx.dir)).toEqual(["/agent/repo", undefined, "/sidebar/repo"])
    expect(h.contexts.map((ctx) => ctx.sessionId)).toEqual(["agent-manager", "editor-tab", "sidebar"])
    expect(h.contexts.at(1)?.workspaceRoot).toBe("/repo")
    expect(h.pollers.map((poller) => poller.directory)).toEqual(["/repo", "/agent/repo", "/sidebar/repo"])
  })

  it("hides the scope picker only for turn reviews, not an explicit workspace source", () => {
    const h = harness()
    h.provider.openFromCommand({ sessionId: "origin", initialSourceId: "workspace" })
    h.provider.openFromCommand({ sessionId: "origin", turnId: "turn-one" })
    expect(h.contexts.at(0)).toMatchObject({ initialSourceId: "workspace", hidePicker: false })
    expect(h.contexts.at(1)?.hidePicker).toBe(true)
  })

  it("keeps PR navigation metadata and routes comments only to the current opening", () => {
    const h = harness()
    const opening = mock(() => undefined)
    const fallback = mock(() => undefined)
    h.provider.setCommentHandler(fallback)
    h.provider.openFromCommand({
      sessionId: "origin",
      directory: "/origin/repo",
      file: review.file,
      comment: review,
      onComments: opening,
      beside: true,
    })
    expect(h.contexts.at(0)).toMatchObject({
      sessionId: "origin",
      dir: "/origin/repo",
      initialFile: review.file,
      comment: review,
      beside: true,
      initialMarkdown: false,
      initialSourceId: "workspace",
      hidePicker: false,
    })
    h.received.fire({ type: "diffViewer.sendComments", comments: ["opening"], autoSend: true })
    h.provider.openFromCommand({ sessionId: "origin", directory: "/origin/repo" })
    h.received.fire({ type: "diffViewer.sendComments", comments: ["default"], autoSend: false })

    expect(opening).toHaveBeenCalledTimes(1)
    expect(opening).toHaveBeenCalledWith(["opening"], true)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(fallback).toHaveBeenCalledWith(["default"], false)
  })
})

describe("DiffViewerProvider remote PR comments", () => {
  it("focuses the live file once when a snapshot is replaced, without jumping on later polls", () => {
    const h = harness()
    h.provider.openPanel({ ...h.ctx, comment: review })
    const index = h.posted.findIndex((message) => message.type === "diffViewer.focusComment")
    expect(index).toBeGreaterThanOrEqual(0)
    expect(
      h.posted.slice(0, index).findLast((message) => message.type === "diffViewer.prComments")?.comments,
    ).toMatchObject([{ threadId: review.id, outdated: true }])
    const count = h.messages("diffViewer.focusComment").length
    const live = comment({ file: "renamed.ts", line: 12 })
    h.pollers.at(0)!.onStatus("diff", status([live]))
    expect(h.comments()).toEqual([live])
    expect(h.messages("diffViewer.focusComment")).toHaveLength(count + 1)
    expect(h.messages("diffViewer.focusComment").at(-1)).toMatchObject({ id: review.id, file: "renamed.ts" })
    h.pollers.at(0)!.onStatus("diff", status([{ ...live, body: "updated" }]))
    expect(h.messages("diffViewer.focusComment")).toHaveLength(count + 1)
  })

  it("keeps a missing selected thread as an outdated unplaced snapshot", () => {
    const h = harness()
    h.provider.openPanel({ ...h.ctx, comment: { ...review, id: "missing-thread" } })
    h.pollers.at(0)!.onStatus("diff", status([comment({ threadId: "other-thread" })]))
    expect(h.comments()?.map((item) => item.threadId)).toEqual(["other-thread", "missing-thread"])
    expect(h.comments()?.at(-1)).toMatchObject({ outdated: true, line: 7 })
  })

  it.each([
    { dir: "/other" },
    { sessionId: "session-2" },
    { sessionId: undefined, dir: undefined, workspaceRoot: "/other" },
  ])("ignores stale callbacks after switching context %j and clears a missing PR", (next) => {
    const h = harness()
    const first = h.pollers.at(0)!
    first.onStatus("diff", status([comment()]))
    h.provider.openPanel({ ...h.ctx, ...next })
    expect(first.stop).toHaveBeenCalledTimes(1)
    expect(h.comments()).toEqual([])
    const second = h.pollers.at(-1)!
    const live = comment({ body: "current" })
    second.onStatus("diff", status([live]))
    first.onStatus("diff", status([comment({ body: "stale" })]))
    expect(h.comments()).toEqual([live])
    second.onStatus("diff", null)
    expect(h.comments()).toEqual([])
  })

  it("retains ambiguous null results only on the same real branch", () => {
    const h = harness()
    const poller = h.pollers.at(0)!
    poller.onStatus("diff", status([comment()]), undefined, "feature")
    poller.onStatus("diff", null, undefined, "feature")
    expect(h.comments()).toEqual([comment()])
    poller.onStatus("diff", null, undefined, "other")
    expect(h.comments()).toEqual([])
  })

  it.each([
    ["feature", "gh_missing"],
    ["feature", "gh_auth"],
    ["feature", "fetch_failed"],
    ["other", "fetch_failed"],
    [undefined, "fetch_failed"],
    [undefined, "gh_auth"],
    [undefined, "gh_missing"],
  ] as const)("retains comments only for verified same-branch errors: %s, %s", (branch, error) => {
    const h = harness()
    const poller = h.pollers.at(0)!
    poller.onStatus("diff", status([comment()]), undefined, "feature")
    poller.onStatus("diff", null, error, branch)
    expect(h.comments()).toEqual(branch === "feature" ? [comment()] : [])
    if (branch === "feature") return
    poller.onStatus("diff", status(), undefined, branch)
    expect(h.comments()).toEqual([])
  })

  it("pauses the poller when hidden and stops it on disposal", () => {
    const h = harness()
    const poller = h.pollers.at(0)!
    for (const visible of [false, true]) {
      h.panel.visible = visible
      h.changed.fire({ webviewPanel: h.panel })
      expect(poller.setVisible).toHaveBeenLastCalledWith(visible)
    }
    h.provider.dispose()
    expect(poller.stop).toHaveBeenCalledTimes(1)
  })

  it("handles standalone PR clipboard and external-link actions", async () => {
    const h = harness()
    const copied = mock(async () => undefined)
    const opened = spyOn(vscode.env, "openExternal").mockResolvedValue(true)
    Object.assign(vscode.env, { clipboard: { writeText: copied } })
    h.received.fire({ type: "agentManager.copyToClipboard", text: "copied" })
    h.received.fire({ type: "openExternal", url: "javascript:alert(1)" })
    h.received.fire({ type: "openExternal", url: "https://github.com/example/repo/pull/42" })
    await Promise.resolve()
    expect(copied).toHaveBeenCalledWith("copied")
    expect(opened).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ path: "https://github.com/example/repo/pull/42" }))
  })
})
