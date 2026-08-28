import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { DiffViewerProvider } from "../../src/diff/DiffViewerProvider"
import type { DiffPRPoller, DiffPRPollerError, DiffPRPollerOptions } from "../../src/diff/pr-poller"
import type { DiffSourceCatalog } from "../../src/diff/sources/catalog"
import type { PRComment, PRStatus } from "../../src/agent-manager/types"

type Panel = {
  webview: {
    cspSource: string
    html: string
    asWebviewUri: (uri: vscode.Uri) => vscode.Uri
    postMessage: (message: unknown) => Promise<boolean>
    onDidReceiveMessage: (handler: (message: unknown) => void) => vscode.Disposable
  }
  visible: boolean
  viewColumn: vscode.ViewColumn
  reveal: (column: vscode.ViewColumn) => void
  dispose: () => void
  onDidDispose: (handler: () => void) => vscode.Disposable
  onDidChangeViewState: (handler: (event: { webviewPanel: Panel }) => void) => vscode.Disposable
}

type Harness = {
  provider: DiffViewerProvider
  panel: Panel
  posted: unknown[]
  pollers: Array<{ opts: DiffPRPollerOptions; poller: FakePoller }>
  fire: (message: unknown) => void
  visible: (value: boolean) => void
}

class FakePoller implements DiffPRPoller {
  visible: boolean | undefined
  enabled = false
  activeId: string | undefined
  stopped = false

  constructor(private readonly opts: DiffPRPollerOptions) {}

  setActiveWorktreeId(id: string | undefined): void {
    this.activeId = id
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  setVisible(visible: boolean): void {
    this.visible = visible
  }

  stop(): void {
    this.stopped = true
  }

  status(status: PRStatus | null, error?: DiffPRPollerError, branch?: string): void {
    this.opts.onStatus("diff", status, error, branch)
  }
}

function event<T>() {
  let listener: ((value: T) => void) | undefined
  return {
    on(handler: (value: T) => void): vscode.Disposable {
      listener = handler
      return new vscode.Disposable(() => {
        if (listener === handler) listener = undefined
      })
    },
    fire(value: T): void {
      listener?.(value)
    },
  }
}

function comment(overrides: Partial<PRComment> = {}): PRComment {
  return {
    id: "comment-id",
    threadId: "thread-id",
    author: "alice",
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

function harness(): Harness {
  const posted: unknown[] = []
  const received = event<unknown>()
  const disposed = event<void>()
  const changed = event<{ webviewPanel: Panel }>()
  const panel: Panel = {
    webview: {
      cspSource: "",
      html: "",
      asWebviewUri: (uri) => uri,
      postMessage: async (message) => {
        posted.push(message)
        return true
      },
      onDidReceiveMessage: (handler) => received.on(handler),
    },
    visible: true,
    viewColumn: vscode.ViewColumn.One,
    reveal: () => {},
    dispose: () => disposed.fire(),
    onDidDispose: (handler) => disposed.on(handler),
    onDidChangeViewState: (handler) => changed.on(handler),
  }
  const pollers: Harness["pollers"] = []
  const window = vscode.window as unknown as {
    createWebviewPanel: (...args: unknown[]) => Panel
  }
  window.createWebviewPanel = () => panel
  const catalog = {
    defaultSourceId: () => undefined,
    listAvailable: () => [],
    build: () => {
      throw new Error("no source expected")
    },
  } as unknown as DiffSourceCatalog
  const provider = new DiffViewerProvider({} as vscode.Uri, { getServerInfo: () => undefined } as never, catalog, {
    createPRPoller: (opts) => {
      const poller = new FakePoller(opts)
      pollers.push({ opts, poller })
      return poller
    },
  })
  provider.openPanel({ workspaceRoot: undefined, sessionId: "session-1", dir: "/repo" })
  return {
    provider,
    panel,
    posted,
    pollers,
    fire: (message) => received.fire(message),
    visible: (value) => {
      panel.visible = value
      changed.fire({ webviewPanel: panel })
    },
  }
}

afterEach(() => {
  const window = vscode.window as unknown as { createWebviewPanel?: unknown }
  delete window.createWebviewPanel
})

describe("DiffViewerProvider remote PR comments", () => {
  it("uses an opening callback only for that opening and keeps the default handler", () => {
    const h = harness()
    const defaultComments: unknown[][] = []
    const openingComments: unknown[][] = []
    h.provider.setCommentHandler((comments) => defaultComments.push(comments))

    h.provider.openPanel({ workspaceRoot: undefined, sessionId: "session-1", dir: "/repo" }, (comments) =>
      openingComments.push(comments),
    )
    h.fire({ type: "diffViewer.sendComments", comments: ["opening"], autoSend: true })
    h.provider.openPanel({ workspaceRoot: undefined, sessionId: "session-1", dir: "/repo" })
    h.fire({ type: "diffViewer.sendComments", comments: ["default"], autoSend: false })

    expect(openingComments).toEqual([["opening"]])
    expect(defaultComments).toEqual([["default"]])
    h.provider.dispose()
  })

  it("sends the selected snapshot before focusing and replaces it with a live match", () => {
    const h = harness()
    h.provider.openPanel({
      workspaceRoot: undefined,
      sessionId: "session-1",
      dir: "/repo",
      comment: {
        id: "thread-id",
        origin: "pr",
        author: "alice",
        body: "snapshot",
        file: "src/app.ts",
        line: 7,
      },
    })
    const live = comment({ body: "live" })
    h.pollers[0]!.poller.status(status([live]))
    const messages = h.posted as Array<{ type?: string; comments?: PRComment[]; id?: string }>
    const comments = messages.filter((message) => message.type === "diffViewer.prComments")
    const focus = messages.findIndex((message) => message.type === "diffViewer.focusComment")
    const latest = comments.at(-1)

    expect(comments[1]?.comments).toMatchObject([{ threadId: "thread-id", outdated: true }])
    expect(focus).toBeGreaterThan(messages.findIndex((message) => message.type === "diffViewer.prComments"))
    expect(latest?.comments).toEqual([live])
    expect(messages[focus]).toMatchObject({ id: "thread-id", file: "src/app.ts" })
    h.provider.dispose()
  })

  it("focuses the live file once when a snapshot is replaced, without jumping on later polls", () => {
    const h = harness()
    h.provider.openPanel({
      workspaceRoot: undefined,
      dir: "/repo",
      sessionId: "session-1",
      comment: { id: "thread-id", origin: "pr", author: "alice", body: "snapshot", file: "old.ts", line: 7 },
    })
    const messages = h.posted as Array<{ type?: string; id?: string; file?: string }>
    const count = messages.filter((message) => message.type === "diffViewer.focusComment").length
    h.pollers[0]!.poller.status(status([comment({ file: "renamed.ts", line: 12 })]))
    const focused = messages.filter((message) => message.type === "diffViewer.focusComment")
    expect(focused).toHaveLength(count + 1)
    expect(focused.at(-1)).toMatchObject({ id: "thread-id", file: "renamed.ts" })
    h.pollers[0]!.poller.status(status([comment({ file: "renamed.ts", line: 12, body: "updated" })]))
    expect(messages.filter((message) => message.type === "diffViewer.focusComment")).toHaveLength(count + 1)
    h.provider.dispose()
  })

  it("keeps a missing selected thread as an outdated unplaced snapshot", () => {
    const h = harness()
    h.provider.openPanel({
      workspaceRoot: undefined,
      sessionId: "session-1",
      dir: "/repo",
      comment: {
        id: "missing-thread",
        origin: "pr",
        author: "alice",
        body: "snapshot",
        file: "src/app.ts",
        line: 7,
      },
    })
    h.pollers[0]!.poller.status(status([comment({ threadId: "other-thread" })]))
    const messages = h.posted as Array<{ type?: string; comments?: PRComment[] }>
    const latest = messages.filter((message) => message.type === "diffViewer.prComments").at(-1)

    expect(latest?.comments?.map((item) => item.threadId)).toEqual(["other-thread", "missing-thread"])
    expect(latest?.comments?.at(-1)).toMatchObject({ outdated: true, line: 7 })
    h.provider.dispose()
  })

  it("drops remote comments on a confirmed missing PR and ignores stale callbacks", () => {
    const h = harness()
    h.provider.openPanel({ workspaceRoot: undefined, sessionId: "session-1", dir: "/repo" })
    const first = h.pollers[0]!.poller
    const live = comment()
    first.status(status([live]))
    h.provider.openPanel({ workspaceRoot: undefined, sessionId: "session-1", dir: "/other" })
    const second = h.pollers[1]!.poller
    first.status(status([comment({ body: "stale" })]))
    second.status(null)
    const messages = h.posted as Array<{ type?: string; comments?: PRComment[] }>
    const latest = messages.filter((message) => message.type === "diffViewer.prComments").at(-1)

    expect(first.stopped).toBe(true)
    expect(latest?.comments).toEqual([])
    h.provider.dispose()
  })

  it("retains comments for an ambiguous null on the same real branch and clears them after a branch change", () => {
    const h = harness()
    h.provider.openPanel({ workspaceRoot: undefined, sessionId: "session-1", dir: "/repo" })
    const poller = h.pollers[0]!.poller
    poller.status(status([comment()]), undefined, "feature")
    poller.status(null, undefined, "feature")
    let messages = h.posted as Array<{ type?: string; comments?: PRComment[] }>
    expect(messages.filter((message) => message.type === "diffViewer.prComments").at(-1)?.comments).toEqual([comment()])

    poller.status(null, undefined, "other")
    messages = h.posted as Array<{ type?: string; comments?: PRComment[] }>
    expect(messages.filter((message) => message.type === "diffViewer.prComments").at(-1)?.comments).toEqual([])
    h.provider.dispose()
  })

  it("retains comments for explicit poll errors", () => {
    const h = harness()
    h.provider.openPanel({ workspaceRoot: undefined, sessionId: "session-1", dir: "/repo" })
    const poller = h.pollers[0]!.poller
    poller.status(status([comment()]), undefined, "feature")
    poller.status(null, "fetch_failed", "feature")
    const messages = h.posted as Array<{ type?: string; comments?: PRComment[] }>
    expect(messages.filter((message) => message.type === "diffViewer.prComments").at(-1)?.comments).toEqual([comment()])
    h.provider.dispose()
  })

  it("pauses the poller when hidden and stops it on disposal", () => {
    const h = harness()
    const poller = h.pollers[0]!.poller
    h.visible(false)
    expect(poller.visible).toBe(false)
    h.visible(true)
    expect(poller.visible).toBe(true)
    h.provider.dispose()

    expect(poller.stopped).toBe(true)
  })

  it("handles standalone PR clipboard and external-link actions", async () => {
    const h = harness()
    const env = vscode.env as unknown as {
      clipboard: { writeText: (text: string) => Promise<void> }
      openExternal: (uri: vscode.Uri) => Promise<boolean>
    }
    const copied: string[] = []
    const opened: vscode.Uri[] = []
    const originalClipboard = env.clipboard
    const originalExternal = env.openExternal
    env.clipboard = { writeText: async (text) => copied.push(text) }
    env.openExternal = async (uri) => {
      opened.push(uri)
      return true
    }

    h.fire({ type: "agentManager.copyToClipboard", text: "copied" })
    h.fire({ type: "openExternal", url: "javascript:alert(1)" })
    h.fire({ type: "openExternal", url: "https://github.com/example/repo/pull/42" })
    await Promise.resolve()

    expect(copied).toEqual(["copied"])
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ path: "https://github.com/example/repo/pull/42" })

    env.clipboard = originalClipboard
    env.openExternal = originalExternal
    h.provider.dispose()
  })
})
