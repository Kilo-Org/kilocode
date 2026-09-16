import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createWorktreeDiffs, diffDataKey } from "../../webview-ui/agent-manager/worktree-diffs"
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

describe("diffDataKey", () => {
  it("preserves the nullish fallback without replacing an empty project", () => {
    expect(diffDataKey(undefined, "s1")).toBe("single\0s1")
    expect(diffDataKey("single", "s1")).toBe("single\0s1")
    expect(diffDataKey("", "s1")).toBe("\0s1")
    expect(diffDataKey("project", "")).toBe("project\0")
    expect(diffDataKey("project", "s1\0file.ts")).toBe("project\0s1\0file.ts")
  })
})

describe("createWorktreeDiffs", () => {
  it.each([undefined, "", "project"])("prunes only the complete project namespace %j", (project) => {
    createRoot((dispose) => {
      const store = createWorktreeDiffs(vscode([]), () => project)
      const sibling = `${project ?? "single"}-other`
      for (const owner of [project, sibling]) {
        store.onWorktreeDiff({
          type: "agentManager.worktreeDiff",
          projectId: owner,
          sessionId: "gone#branch",
          diffs: [diff("a.ts")],
        })
      }

      store.prune(new Set())
      expect(store.diffDatas()[`${project ?? "single"}\0gone#branch`]).toBeUndefined()
      expect(store.diffDatas()[`${sibling}\0gone#branch`]).toHaveLength(1)
      dispose()
    })
  })

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

  it("prunes every scope of deleted worktrees without dropping local or other-project reviews", () => {
    createRoot((dispose) => {
      const store = createWorktreeDiffs(vscode([]), () => "project-a")
      for (const id of ["gone#branch", "gone#staged", "live#branch", "local#session:s1"]) {
        store.onWorktreeDiff({
          type: "agentManager.worktreeDiff",
          projectId: "project-a",
          sessionId: id,
          diffs: [diff("a.ts")],
        })
      }
      store.onWorktreeDiff({
        type: "agentManager.worktreeDiff",
        projectId: "project-b",
        sessionId: "gone#branch",
        diffs: [diff("b.ts")],
      })
      store.onWorktreeDiffLoading({
        type: "agentManager.worktreeDiffLoading",
        projectId: "project-a",
        sessionId: "gone#branch",
        loading: true,
      })
      store.onWorktreeDiffNotice({
        type: "agentManager.worktreeDiffNotice",
        projectId: "project-a",
        sessionId: "gone#branch",
        notice: "deleted",
      })
      store.requestDiffFile("gone#branch", "a.ts")
      store.prune(new Set(["live"]))

      expect(Object.keys(store.diffDatas()).sort()).toEqual([
        "project-a\0live#branch",
        "project-a\0local#session:s1",
        "project-b\0gone#branch",
      ])
      expect(store.diffFileLoadingFor(() => "gone#branch").size).toBe(0)
      expect(store.diffNotices()["project-a\0gone#branch"]).toBeUndefined()
      expect(store.diffLoading()).toBe(false)
      dispose()
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
      diffs.requestDiffFile("s1", "a.ts")
      expect(diffs.diffFileLoadingFor(() => "s1").has("a.ts")).toBe(true)
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

  it("keeps failed detail visible through polling and retry", () => {
    withDiffs((diffs) => {
      const summary = { ...diff("a.ts"), summarized: true }
      const message = { type: "agentManager.worktreeDiffFile", sessionId: "s1", file: "a.ts" } as const
      const current = () => diffs.diffDatas()["single\0s1"]?.at(0)
      diffs.onWorktreeDiff({ type: "agentManager.worktreeDiff", sessionId: "s1", diffs: [summary] })
      diffs.requestDiffFile("s1", "a.ts")
      diffs.onWorktreeDiffFile({ ...message, diff: null })
      expect(current()).toEqual({ ...summary, failed: true })
      expect(diffs.diffFileLoadingFor(() => "s1").size).toBe(0)
      diffs.onWorktreeDiff({ type: "agentManager.worktreeDiff", sessionId: "s1", diffs: [{ ...summary }] })
      expect(current()?.failed).toBe(true)
      diffs.requestDiffFile("s1", "a.ts")
      expect(current()?.failed).toBe(true)
      expect(diffs.diffFileLoadingFor(() => "s1").has("a.ts")).toBe(true)
      const detail = { ...summary, before: "old", after: "new", summarized: false }
      diffs.onWorktreeDiffFile({ ...message, diff: detail })
      expect(current()).toBe(detail)
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

  it("resets cancelled files on activation without resetting another project or ordinary refreshes", () => {
    withDiffs((diffs, sent) => {
      const loading = { type: "agentManager.worktreeDiffLoading", sessionId: "s1", loading: true } as const
      const other = () => diffs.refreshStaleDiffs("s1", new Set(["b.ts"]), diffDataKey("other", "s1"), "other")
      const summary = { ...diff("a.ts"), summarized: true }
      diffs.onWorktreeDiff({ type: "agentManager.worktreeDiff", sessionId: "s1", diffs: [summary] })
      diffs.requestDiffFile("s1", "a.ts")
      other()
      diffs.onWorktreeDiffLoading(loading)
      expect(diffs.diffFileLoadingFor(() => "s1").has("a.ts")).toBe(true)
      expect(diffs.diffLoadingFor(() => "s2")).toBe(false)

      diffs.onWorktreeDiffLoading({ ...loading, sessionId: "s2", reset: true })
      expect(diffs.diffFileLoadingFor(() => "s1").size).toBe(0)
      expect(diffs.diffDatas()["single\0s1"]?.at(0)?.failed).toBeUndefined()
      diffs.onWorktreeDiffLoading({ ...loading, reset: true })
      diffs.requestDiffFile("s1", "a.ts")
      other()
      expect(sent).toHaveLength(3)
      expect(diffs.diffFileLoadingFor(() => "s1").has("a.ts")).toBe(true)
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
})
