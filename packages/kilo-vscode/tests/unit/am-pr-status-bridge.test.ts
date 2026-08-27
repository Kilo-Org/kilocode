import { describe, expect, it, mock, beforeEach } from "bun:test"

const resolveComment = mock(async (_threadId: string, _cwd: string) => {})
const unresolveComment = mock(async (_threadId: string, _cwd: string) => {})

mock.module("../../src/agent-manager/pr/PRActions", () => ({ resolveComment, unresolveComment }))

import { PRStatusBridge } from "../../src/agent-manager/pr-status-bridge"
import { PRStatusPoller } from "../../src/agent-manager/PRStatusPoller"
import type { AgentManagerOutMessage, PRStatus } from "../../src/agent-manager/types"

const pr: PRStatus = {
  number: 1,
  title: "my PR",
  url: "https://github.com/x/y/pull/1",
  state: "open",
  review: null,
  checks: { status: "none", total: 0, passed: 0, failed: 0, pending: 0, checks: [] },
  reviewers: [],
  additions: 0,
  deletions: 0,
  files: 0,
}

function harness(opts: { hasPersisted?: boolean; projectId?: string } = {}) {
  const sent: AgentManagerOutMessage[] = []
  const opened: string[] = []
  const reads: (string | undefined)[] = []
  const worktrees: { id: string; path: string; branch: string; prUrl?: string }[] = [
    { id: "wt1", path: "/repo/wt1", branch: "feature" },
  ]
  const bridge = PRStatusBridge.create({
    getWorktrees: () => worktrees as never,
    getWorkspaceRoot: () => "/repo",
    postToWebview: (msg) => sent.push(msg),
    updateWorktreePR: () => {},
    hasPersistedPR: () => opts.hasPersisted ?? false,
    openExternal: (url) => opened.push(url),
    log: () => {},
    projectId: () => {
      reads.push(opts.projectId)
      return opts.projectId
    },
  })
  const onStatus = (bridge.poller as unknown as { options: { onStatus: (...a: unknown[]) => void } }).options.onStatus
  return { bridge, sent, opened, onStatus, worktrees, reads }
}

describe("PRStatusPoller batched GitHub queries", () => {
  it("loads checks and reviewers with one request and isolates projects and detached worktrees", async () => {
    let root = "/alpha"
    const tree = { id: "wt1", path: "/alpha/feature", branch: "feature" }
    const calls: string[][] = []
    const values: PRStatus[] = []
    const poller = new PRStatusPoller({
      getWorktrees: () => [tree] as never,
      getWorkspaceRoot: () => root,
      onStatus: (_id, status) => {
        if (status) values.push(status)
      },
      log: () => undefined,
    })
    const internal = poller as unknown as {
      fetchOne: (id: string) => Promise<void>
      target: (id: string) => typeof tree
      gh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
    }
    internal.target = () => tree
    internal.gh = async (args) => {
      calls.push(args)
      return {
        stdout: JSON.stringify({
          number: root === "/alpha" ? 1 : tree.branch === "HEAD" ? (tree.path.endsWith("one") ? 3 : 4) : 2,
          url: `https://github.com/example/${root.slice(1)}/pull/1`,
          statusCheckRollup: [{ name: "build", conclusion: "SUCCESS" }],
          reviewRequests: [{ login: "reviewer" }],
          reviews: [],
        }),
        stderr: "",
      }
    }

    await internal.fetchOne("wt1")
    root = "/beta"
    tree.path = "/beta/feature"
    await internal.fetchOne("wt1")
    tree.branch = "HEAD"
    tree.path = "/beta/one"
    await internal.fetchOne("wt1")
    tree.path = "/beta/two"
    await internal.fetchOne("wt1")

    expect(calls).toHaveLength(4)
    expect(calls.every((args) => args[0] === "pr" && args[1] === "view")).toBe(true)
    expect(calls[0]?.at(-1)).toContain("statusCheckRollup,reviewRequests,reviews")
    expect(values.map((item) => item.number)).toEqual([1, 2, 3, 4])
    expect(values[0]?.checks.passed).toBe(1)
    expect(values[0]?.reviewers).toEqual([{ login: "reviewer", avatar: undefined, state: "pending" }])
  })

  it.each([['Unknown JSON field: "statusCheckRollup"'], ["GraphQL: Resource not accessible by integration"]])(
    "retries basic pull request fields after %s",
    async (message) => {
      const poller = new PRStatusPoller({
        getWorktrees: () => [],
        getWorkspaceRoot: () => "/repo",
        onStatus: () => undefined,
        log: () => undefined,
      })
      const calls: string[][] = []
      const internal = poller as unknown as {
        query: (args: string[], cwd: string) => Promise<string>
        gh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
      }
      internal.gh = async (args) => {
        calls.push(args)
        if (args.at(-1)?.includes("statusCheckRollup")) throw new Error(message)
        return { stdout: '{"number":1}', stderr: "" }
      }

      expect(await internal.query(["pr", "view"], "/repo")).toBe('{"number":1}')
      expect(await internal.query(["pr", "view"], "/repo")).toBe('{"number":1}')
      expect(calls).toHaveLength(3)
      expect(calls[1]?.at(-1)).not.toContain("statusCheckRollup")
      expect(calls[2]?.at(-1)).not.toContain("statusCheckRollup")

      poller.stop()
      expect(await internal.query(["pr", "view"], "/repo")).toBe('{"number":1}')
      expect(calls).toHaveLength(5)
      expect(calls[3]?.at(-1)).toContain("statusCheckRollup")
    },
  )
})

describe("PRStatusBridge.handleMessage openPR", () => {
  it("opens an explicit URL from a background project", () => {
    const { bridge, opened } = harness({ projectId: "active" })

    bridge.handleMessage({
      type: "agentManager.openPR",
      projectId: "background",
      worktreeId: "wt1",
      url: "https://github.com/x/y/pull/2",
    })

    expect(opened).toEqual(["https://github.com/x/y/pull/2"])
  })

  it("does not look up a background worktree without an explicit URL", () => {
    const { bridge, opened, worktrees } = harness({ projectId: "active" })
    worktrees[0]!.prUrl = "https://github.com/x/y/pull/1"

    bridge.handleMessage({ type: "agentManager.openPR", projectId: "background", worktreeId: "wt1" })

    expect(opened).toEqual([])
  })
})

// --- error deduplication ---

describe("PRStatusBridge.notifyError", () => {
  it("sends the first error notification", () => {
    const { bridge, sent } = harness()
    bridge.notifyError("gh_missing")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({ type: "agentManager.prError", error: "gh_missing" }))
  })

  it("tags errors with their owning project", () => {
    const { bridge, sent, reads } = harness({ projectId: "project-a" })
    bridge.notifyError("gh_missing")
    expect(sent).toEqual([{ type: "agentManager.prError", projectId: "project-a", error: "gh_missing" }])
    expect(reads).toEqual(["project-a"])
  })

  it("deduplicates the same error type", () => {
    const { bridge, sent } = harness()
    bridge.notifyError("gh_auth")
    bridge.notifyError("gh_auth")
    expect(sent).toHaveLength(1)
  })

  it("sends again when error type changes", () => {
    const { bridge, sent } = harness()
    bridge.notifyError("gh_missing")
    bridge.notifyError("gh_auth")
    expect(sent).toHaveLength(2)
  })
})

// --- onStatus cache suppression ---

describe("PRStatusBridge onStatus", () => {
  it("forwards a successful status to the webview", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", pr)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({ type: "agentManager.prStatus", worktreeId: "wt1", pr }))
  })

  it("forwards pr:null error when no cache entry and no persisted PR", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", null, "fetch_failed")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({ type: "agentManager.prStatus", worktreeId: "wt1", pr: null }))
  })

  it("suppresses pr:null error when cache entry exists", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    onStatus("wt1", null, "fetch_failed")
    expect(sent).toHaveLength(0)
  })

  it("suppresses pr:null error when persisted PR exists", () => {
    const { sent, onStatus } = harness({ hasPersisted: true })
    onStatus("wt1", null, "fetch_failed")
    expect(sent).toHaveLength(0)
  })

  it("forwards gh_auth error even when cache entry exists", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    onStatus("wt1", null, "gh_auth")
    const errorMsg = sent.find((m) => m.type === "agentManager.prError")
    expect(errorMsg).toEqual(expect.objectContaining({ error: "gh_auth" }))
  })

  it("forwards gh_missing error even when cache entry exists", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    onStatus("wt1", null, "gh_missing")
    const errorMsg = sent.find((m) => m.type === "agentManager.prError")
    expect(errorMsg).toEqual(expect.objectContaining({ error: "gh_missing" }))
  })

  // A rate limit, a network blip, or an unresolvable fork ref all look like "no
  // pull request". Forwarding that unmounts the panel and discards what the user
  // has open, so a PR already found on this branch stays.
  it("keeps a known PR when a poll finds no pull request on the same branch", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    onStatus("wt1", null)
    expect(sent).toHaveLength(0)
    expect(bridge.snapshot().get("wt1")).toEqual(pr)
  })

  it("drops the PR once the worktree is on another branch", () => {
    const { bridge, sent, onStatus, worktrees } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    worktrees[0]!.branch = "other"
    onStatus("wt1", null)
    expect(sent).toEqual([expect.objectContaining({ type: "agentManager.prStatus", worktreeId: "wt1", pr: null })])
    expect(bridge.snapshot().has("wt1")).toBe(false)
  })

  it("forwards no pull request for a worktree that never had one", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", null)
    expect(sent).toEqual([expect.objectContaining({ type: "agentManager.prStatus", worktreeId: "wt1", pr: null })])
  })

  it("reports the PR again after a branch switch back", () => {
    const { bridge, onStatus, worktrees } = harness()
    onStatus("wt1", pr)
    worktrees[0]!.branch = "other"
    onStatus("wt1", null)
    worktrees[0]!.branch = "feature"
    onStatus("wt1", pr)
    expect(bridge.snapshot().get("wt1")).toEqual(pr)
  })
})

// --- replay ---

describe("PRStatusBridge.replay", () => {
  it("replays cached status messages", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    bridge.replay()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({ type: "agentManager.prStatus", worktreeId: "wt1" }))
  })

  it("replays the last auth error on reconnect", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", null, "gh_auth")
    sent.length = 0
    bridge.replay()
    expect(
      sent.some((m) => m.type === "agentManager.prError" && (m as never as { error: string }).error === "gh_auth"),
    ).toBe(true)
  })

  it("preserves project ownership when replaying an error", () => {
    const { bridge, sent, onStatus, reads } = harness({ projectId: "project-a" })
    onStatus("wt1", null, "gh_missing")
    sent.length = 0
    reads.length = 0
    bridge.replay()
    expect(sent).toEqual([{ type: "agentManager.prError", projectId: "project-a", error: "gh_missing" }])
    expect(reads).toEqual(["project-a"])
  })

  it("does not replay fetch_failed errors", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", null, "fetch_failed")
    sent.length = 0
    bridge.replay()
    expect(sent).toHaveLength(0)
  })
})

// --- snapshot ---

describe("PRStatusBridge.snapshot", () => {
  it("returns only entries with a non-null pr", () => {
    const { bridge, onStatus } = harness()
    onStatus("wt1", pr)
    onStatus("wt2", pr)
    expect(bridge.snapshot().size).toBe(2)
  })

  it("excludes entries where pr was null", () => {
    const { bridge, onStatus } = harness({ hasPersisted: true })
    onStatus("wt1", null, "fetch_failed")
    expect(bridge.snapshot().size).toBe(0)
  })
})

// --- remove / reset ---

describe("PRStatusBridge.remove", () => {
  it("removes a cached entry so it is no longer replayed", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", pr)
    bridge.remove("wt1")
    sent.length = 0
    bridge.replay()
    expect(sent).toHaveLength(0)
  })
})

describe("PRStatusBridge.reset", () => {
  it("clears cache and error state so replay sends nothing", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", pr)
    bridge.notifyError("gh_auth")
    bridge.reset()
    sent.length = 0
    bridge.replay()
    expect(sent).toHaveLength(0)
  })

  it("allows the same error to be sent again after reset", () => {
    const { bridge, sent } = harness()
    bridge.notifyError("gh_auth")
    bridge.reset()
    sent.length = 0
    bridge.notifyError("gh_auth")
    expect(sent).toHaveLength(1)
  })
})

// --- resolveComment / unresolveComment message handling ---

describe("PRStatusBridge.handleMessage resolveComment", () => {
  beforeEach(() => {
    resolveComment.mockReset()
    unresolveComment.mockReset()
  })

  it("returns true for agentManager.resolveComment", () => {
    const { bridge } = harness()
    resolveComment.mockResolvedValueOnce(undefined)
    expect(bridge.handleMessage({ type: "agentManager.resolveComment", worktreeId: "wt1", threadId: "PRT_1" })).toBe(
      true,
    )
  })

  it("returns true for agentManager.unresolveComment", () => {
    const { bridge } = harness()
    unresolveComment.mockResolvedValueOnce(undefined)
    expect(bridge.handleMessage({ type: "agentManager.unresolveComment", worktreeId: "wt1", threadId: "PRT_1" })).toBe(
      true,
    )
  })

  it("posts resolveCommentResult with success:true on resolve success", async () => {
    const { bridge, sent } = harness()
    resolveComment.mockResolvedValueOnce(undefined)
    bridge.handleMessage({ type: "agentManager.resolveComment", worktreeId: "wt1", threadId: "PRT_1" })
    await Promise.resolve()
    const result = sent.find((m) => m.type === "agentManager.resolveCommentResult")
    expect(result).toEqual(
      expect.objectContaining({
        type: "agentManager.resolveCommentResult",
        worktreeId: "wt1",
        threadId: "PRT_1",
        success: true,
      }),
    )
  })

  it("posts unresolveCommentResult with success:true on unresolve success", async () => {
    const { bridge, sent } = harness()
    unresolveComment.mockResolvedValueOnce(undefined)
    bridge.handleMessage({ type: "agentManager.unresolveComment", worktreeId: "wt1", threadId: "PRT_1" })
    await Promise.resolve()
    const result = sent.find((m) => m.type === "agentManager.unresolveCommentResult")
    expect(result).toEqual(expect.objectContaining({ success: true }))
  })

  it("posts resolveCommentResult with success:false on failure", async () => {
    const { bridge, sent } = harness()
    resolveComment.mockRejectedValueOnce(new Error("gh: Not Found"))
    bridge.handleMessage({ type: "agentManager.resolveComment", worktreeId: "wt1", threadId: "PRT_1" })
    await Promise.resolve()
    const result = sent.find((m) => m.type === "agentManager.resolveCommentResult")
    expect(result).toEqual(expect.objectContaining({ success: false }))
  })

  it("logs and returns early when no cwd found", () => {
    const logged: unknown[] = []
    const bridge = PRStatusBridge.create({
      getWorktrees: () => [] as never,
      getWorkspaceRoot: () => undefined,
      postToWebview: () => {},
      updateWorktreePR: () => {},
      hasPersistedPR: () => false,
      openExternal: () => {},
      log: (...args) => logged.push(args),
    })
    bridge.handleMessage({ type: "agentManager.resolveComment", worktreeId: "wt-missing", threadId: "PRT_1" })
    expect(resolveComment).not.toHaveBeenCalled()
    expect(logged.length).toBeGreaterThan(0)
  })
})
