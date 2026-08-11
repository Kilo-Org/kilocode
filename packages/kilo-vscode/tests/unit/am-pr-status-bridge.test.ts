import { describe, expect, it } from "bun:test"
import { PRStatusBridge } from "../../src/agent-manager/pr-status-bridge"
import type { AgentManagerOutMessage, PRStatus } from "../../src/agent-manager/types"

const pr: PRStatus = {
  number: 1,
  title: "my PR",
  url: "https://github.com/x/y/pull/1",
  state: "open",
  review: null,
  checks: { status: "none", total: 0, passed: 0, failed: 0, pending: 0, checks: [] },
  additions: 0,
  deletions: 0,
  files: 0,
}

function harness(opts: { hasPersisted?: boolean } = {}) {
  const sent: AgentManagerOutMessage[] = []
  const worktrees: { id: string; prUrl?: string }[] = []
  const bridge = PRStatusBridge.create({
    getWorktrees: () => worktrees as never,
    getWorkspaceRoot: () => "/repo",
    postToWebview: (msg) => sent.push(msg),
    updateWorktreePR: () => {},
    hasPersistedPR: () => opts.hasPersisted ?? false,
    openExternal: () => {},
    log: () => {},
  })
  const onStatus = (bridge.poller as unknown as { options: { onStatus: (...a: unknown[]) => void } }).options.onStatus
  return { bridge, sent, onStatus }
}

// --- error deduplication ---

describe("PRStatusBridge.notifyError", () => {
  it("sends the first error notification", () => {
    const { bridge, sent } = harness()
    bridge.notifyError("gh_missing")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({ type: "agentManager.prError", error: "gh_missing" }))
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
