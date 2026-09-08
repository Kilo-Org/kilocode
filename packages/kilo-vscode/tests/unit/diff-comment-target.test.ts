import { expect, it } from "bun:test"
import * as vscode from "vscode"
import { DiffViewerProvider } from "../../src/diff/DiffViewerProvider"
import type { DiffPRPollerOptions } from "../../src/diff/pr-poller"
import type { PRStatus } from "../../src/agent-manager/types"
import type { PRTarget } from "../../src/shared/pr-comment-actions"

it("binds standalone targets to the real panel generation and excludes historical threads", () => {
  const original = vscode.window.createWebviewPanel
  const messages: Array<{ type: string; target?: PRTarget; threads?: string[] }> = []
  const callbacks: DiffPRPollerOptions[] = []
  const listener = () => new vscode.Disposable(() => undefined)
  vscode.window.createWebviewPanel = () =>
    ({
      webview: {
        cspSource: "",
        html: "",
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: async (message: (typeof messages)[number]) => {
          messages.push(message)
          return true
        },
        onDidReceiveMessage: listener,
      },
      visible: true,
      reveal: () => undefined,
      onDidDispose: listener,
      onDidChangeViewState: listener,
    }) as unknown as vscode.WebviewPanel
  const provider = new DiffViewerProvider(
    {} as vscode.Uri,
    { getServerInfo: () => undefined } as never,
    { defaultSourceId: () => undefined, listAvailable: () => [] } as never,
    {
      createPRPoller: (opts) => {
        callbacks.push(opts)
        return {
          stop: () => undefined,
          setEnabled: () => undefined,
          setVisible: () => undefined,
          setActiveWorktreeId: () => undefined,
          refresh: () => undefined,
        }
      },
    },
  )
  const context = {
    workspaceRoot: "/host/project",
    comment: {
      id: "historical",
      origin: "pr" as const,
      author: "reviewer",
      body: "Snapshot",
      file: "file.ts",
      line: 1,
    },
  }
  const pr = {
    number: 42,
    url: "https://github.com/example/repo/pull/42",
    comments: {
      total: 1,
      unresolved: 1,
      comments: [
        { id: "root", threadId: "live", author: "reviewer", body: "Current", resolved: false, outdated: false },
      ],
    },
  } as PRStatus
  const latest = () => messages.findLast((message) => message.type === "diffViewer.prComments")!
  try {
    provider.openPanel(context)
    expect(latest().target).toBeUndefined()
    callbacks[0]!.onStatus("diff", pr, undefined, "feature")
    const first = latest().target!
    expect(first).toMatchObject({ worktreeId: "diff", prNumber: 42, prUrl: pr.url })
    expect(first.projectId).toBeTruthy()
    expect(latest().threads).toEqual(["live"])
    provider.openPanel(context)
    const second = latest().target!
    expect(second.projectId).not.toBe(first.projectId)
    callbacks[0]!.onStatus("diff", pr, undefined, "other-branch")
    expect(latest().target?.projectId).not.toBe(second.projectId)
    provider.openPanel({ workspaceRoot: "/other/project" })
    expect(latest().target).toBeUndefined()
    callbacks[0]!.onStatus("diff", pr, undefined, "feature")
    expect(latest().target).toBeUndefined()
  } finally {
    provider.dispose()
    vscode.window.createWebviewPanel = original
  }
})
