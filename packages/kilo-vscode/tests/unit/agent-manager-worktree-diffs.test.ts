import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createWorktreeDiffs } from "../../webview-ui/agent-manager/worktree-diffs"
import type { WorktreeFileDiff } from "../../webview-ui/src/types/messages"

const diff = (file: string, additions = 1): WorktreeFileDiff => ({
  file,
  before: "",
  after: "",
  additions,
  deletions: 0,
})

interface Sent {
  type: string
  sessionId?: string
  file?: string
}

// Only `postMessage` is exercised by the diff workflow, so a recording stub is
// enough — the signals and merge/pending logic under test are the real thing.
const vscode = (sent: Sent[]) =>
  ({ postMessage: (msg: Sent) => sent.push(msg) }) as unknown as Parameters<typeof createWorktreeDiffs>[0]

const withDiffs = (fn: (diffs: ReturnType<typeof createWorktreeDiffs>, sent: Sent[]) => void) => {
  createRoot((dispose) => {
    const sent: Sent[] = []
    fn(createWorktreeDiffs(vscode(sent)), sent)
    dispose()
  })
}

describe("createWorktreeDiffs", () => {
  it("stores full diffs per session", () => {
    withDiffs((diffs) => {
      diffs.onWorktreeDiff({ type: "agentManager.worktreeDiff", sessionId: "s1", diffs: [diff("a.ts")] })
      expect(diffs.diffDatas()["single\0s1"]).toHaveLength(1)
    })
  })

  it("retains completed details beyond the mounted review-panel limit", () => {
    withDiffs((diffs) => {
      const entry = { ...diff("a.ts"), before: "before", after: "after", patch: "+after", summarized: false }
      diffs.onWorktreeDiff({ type: "agentManager.worktreeDiff", sessionId: "s1", diffs: [diff("a.ts")] })
      diffs.onWorktreeDiffFile({
        type: "agentManager.worktreeDiffFile",
        sessionId: "s1",
        file: "a.ts",
        diff: entry,
      })
      for (let index = 2; index <= 5; index++) {
        diffs.onWorktreeDiff({
          type: "agentManager.worktreeDiff",
          sessionId: `s${index}`,
          diffs: [diff(`${index}.ts`)],
        })
      }

      diffs.retain("s1")
      expect(diffs.diffDatas()["single\0s1"]?.[0]).toBe(entry)
      expect(Object.keys(diffs.diffDatas())).toHaveLength(5)
    })
  })

  it("evicts the least recently used retained worktree data", () => {
    withDiffs((diffs) => {
      for (let index = 1; index <= 16; index++) {
        diffs.onWorktreeDiff({
          type: "agentManager.worktreeDiff",
          sessionId: `s${index}`,
          diffs: [diff(`${index}.ts`)],
        })
      }
      diffs.retain("s1")
      diffs.onWorktreeDiff({ type: "agentManager.worktreeDiff", sessionId: "s17", diffs: [diff("17.ts")] })

      expect(diffs.diffDatas()["single\0s1"]).toHaveLength(1)
      expect(diffs.diffDatas()["single\0s2"]).toBeUndefined()
      expect(diffs.diffDatas()["single\0s17"]).toHaveLength(1)
      expect(Object.keys(diffs.diffDatas())).toHaveLength(16)
    })
  })

  it("bounds retained worktree content without evicting the active context", () => {
    withDiffs((diffs) => {
      const content = "x".repeat(17 * 1024 * 1024)
      diffs.onWorktreeDiff({
        type: "agentManager.worktreeDiff",
        sessionId: "s1",
        diffs: [{ ...diff("first.ts"), before: content }],
      })
      diffs.onWorktreeDiff({
        type: "agentManager.worktreeDiff",
        sessionId: "s2",
        diffs: [{ ...diff("second.ts"), before: content }],
      })

      expect(diffs.diffDatas()["single\0s1"]).toBeUndefined()
      expect(diffs.diffDatas()["single\0s2"]).toHaveLength(1)
    })
  })

  it("does not replace state when an update produces an identical diff list", () => {
    withDiffs((diffs) => {
      diffs.onWorktreeDiff({ type: "agentManager.worktreeDiff", sessionId: "s1", diffs: [diff("a.ts")] })
      const before = diffs.diffDatas()
      diffs.onWorktreeDiff({ type: "agentManager.worktreeDiff", sessionId: "s1", diffs: [diff("a.ts")] })
      expect(diffs.diffDatas()).toBe(before)
    })
  })

  it("replaces a single file on a diffFile message and clears its pending flag", () => {
    withDiffs((diffs) => {
      diffs.onWorktreeDiff({ type: "agentManager.worktreeDiff", sessionId: "s1", diffs: [diff("a.ts", 1)] })
      diffs.onWorktreeDiffFile({
        type: "agentManager.worktreeDiffFile",
        sessionId: "s1",
        file: "a.ts",
        diff: diff("a.ts", 9),
      })
      expect(diffs.diffDatas()["single\0s1"]![0]!.additions).toBe(9)
      expect(diffs.diffFileLoadingFor(() => "s1").size).toBe(0)
    })
  })

  it("tracks panel loading via diffLoading", () => {
    withDiffs((diffs) => {
      diffs.onWorktreeDiffLoading({ type: "agentManager.worktreeDiffLoading", sessionId: "s1", loading: true })
      expect(diffs.diffLoading()).toBe(true)
      expect(diffs.diffLoadingFor(() => "s1")).toBe(true)
      diffs.onWorktreeDiff({ type: "agentManager.worktreeDiff", sessionId: "s1", diffs: [] })
      expect(diffs.diffLoadingFor(() => "s1")).toBe(false)
      diffs.onWorktreeDiffLoading({ type: "agentManager.worktreeDiffLoading", sessionId: "s1", loading: false })
      expect(diffs.diffLoading()).toBe(false)
    })
  })

  it("keeps loading isolated to its composite diff id", () => {
    withDiffs((diffs) => {
      diffs.onWorktreeDiffLoading({ type: "agentManager.worktreeDiffLoading", sessionId: "s1#branch", loading: true })
      expect(diffs.diffLoadingFor(() => "s1#branch")).toBe(true)
      expect(diffs.diffLoadingFor(() => "s2#branch")).toBe(false)
    })
  })

  it("requestDiffFile marks a file pending, posts once, and ignores repeats", () => {
    withDiffs((diffs, sent) => {
      diffs.requestDiffFile("s1", "a.ts")
      diffs.requestDiffFile("s1", "a.ts")
      expect(sent.filter((m) => m.type === "agentManager.requestWorktreeDiffFile")).toHaveLength(1)
      expect(diffs.diffFileLoadingFor(() => "s1").has("a.ts")).toBe(true)
    })
  })

  it("refreshStaleDiffs requests only files not already loading", () => {
    withDiffs((diffs, sent) => {
      diffs.requestDiffFile("s1", "a.ts")
      diffs.refreshStaleDiffs("s1", new Set(["a.ts", "b.ts"]))
      const files = sent.filter((m) => m.type === "agentManager.requestWorktreeDiffFile").map((m) => m.file)
      expect(files).toEqual(["a.ts", "b.ts"])
    })
  })

  it("clears the session key once its last pending file resolves", () => {
    withDiffs((diffs) => {
      diffs.requestDiffFile("s1", "a.ts")
      diffs.onWorktreeDiffFile({
        type: "agentManager.worktreeDiffFile",
        sessionId: "s1",
        file: "a.ts",
        diff: diff("a.ts"),
      })
      expect(diffs.diffFileLoadingFor(() => "s1").size).toBe(0)
    })
  })
})
