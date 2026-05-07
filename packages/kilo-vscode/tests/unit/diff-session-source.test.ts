import { describe, it, expect } from "bun:test"
import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import { SessionDiffSource, type SessionDiffFetch, type SnapshotEnabledCheck } from "../../src/diff/sources/session"
import type { DiffSourceMessage } from "../../src/diff/sources/types"

type FetchCall = { sessionID: string; directory?: string }

function recording(result: SnapshotFileDiff[] | Error): { fetch: SessionDiffFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetch: SessionDiffFetch = async (params) => {
    calls.push(params)
    if (result instanceof Error) throw result
    return result
  }
  return { fetch, calls }
}

function collect(): { post: (msg: DiffSourceMessage) => void; messages: DiffSourceMessage[] } {
  const messages: DiffSourceMessage[] = []
  return { post: (msg) => messages.push(msg), messages }
}

const modifiedPatch = [
  "diff --git a/foo.ts b/foo.ts",
  "--- a/foo.ts",
  "+++ b/foo.ts",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "+new",
].join("\n")

describe("SessionDiffSource.initialFetch", () => {
  it("posts loading/diffs/loading for an empty session", async () => {
    const { fetch, calls } = recording([])
    const source = new SessionDiffSource("s1", fetch, "/repo")
    const { post, messages } = collect()

    await source.initialFetch(post)

    expect(calls).toEqual([{ sessionID: "s1", directory: "/repo" }])
    expect(messages).toEqual([
      { type: "loading", loading: true },
      { type: "diffs", diffs: [] },
      { type: "loading", loading: false },
    ])
  })

  it("converts patches into before/after diffs", async () => {
    const raw: SnapshotFileDiff[] = [
      {
        file: "foo.ts",
        patch: modifiedPatch,
        additions: 1,
        deletions: 1,
        status: "modified",
      },
      {
        file: "big.bin",
        patch: "",
        additions: 0,
        deletions: 0,
        status: "modified",
      },
    ]
    const { fetch } = recording(raw)
    const source = new SessionDiffSource("s2", fetch, "/repo")
    const { post, messages } = collect()

    await source.initialFetch(post)

    const diffsMsg = messages.find((m) => m.type === "diffs")
    if (diffsMsg?.type !== "diffs") throw new Error("expected diffs message")
    expect(diffsMsg.diffs).toHaveLength(2)

    const foo = diffsMsg.diffs[0]!
    expect(foo.file).toBe("foo.ts")
    expect(foo.before).toBe("keep\nold\n")
    expect(foo.after).toBe("keep\nnew\n")
    expect(foo.additions).toBe(1)
    expect(foo.deletions).toBe(1)
    expect(foo.status).toBe("modified")
    expect(foo.tracked).toBe(true)
    expect(foo.generatedLike).toBe(false)
    expect(foo.summarized).toBe(false)

    const big = diffsMsg.diffs[1]!
    expect(big.summarized).toBe(true)
    expect(big.before).toBe("")
    expect(big.after).toBe("")
  })

  it("reports an error when the fetch throws", async () => {
    const { fetch } = recording(new Error("network down"))
    const source = new SessionDiffSource("s3", fetch)
    const { post, messages } = collect()

    await source.initialFetch(post)

    expect(messages).toEqual([
      { type: "loading", loading: true },
      { type: "error", message: "network down" },
      { type: "loading", loading: false },
    ])
  })

  it("calls fetch without directory when workspaceRoot is not given", async () => {
    const { fetch, calls } = recording([])
    const source = new SessionDiffSource("s4", fetch)
    const { post } = collect()

    await source.initialFetch(post)

    expect(calls).toEqual([{ sessionID: "s4", directory: undefined }])
  })
})

describe("SessionDiffSource lifecycle", () => {
  it("dispose does not throw", () => {
    const { fetch } = recording([])
    const source = new SessionDiffSource("s6", fetch)
    source.dispose()
  })

  it("descriptor id encodes the session id", () => {
    const { fetch } = recording([])
    const source = new SessionDiffSource("abc", fetch)
    expect(source.descriptor.id).toBe("session:abc")
    expect(source.descriptor.group).toBe("Session")
    expect(source.descriptor.capabilities).toEqual({ revert: false, comments: true })
  })

  it("posts the snapshots-disabled notice and skips fetch when the check returns false", async () => {
    const { fetch, calls } = recording([
      { file: "foo.ts", patch: modifiedPatch, additions: 1, deletions: 1, status: "modified" },
    ])
    const checkSnapshotsEnabled: SnapshotEnabledCheck = async () => false
    const source = new SessionDiffSource("s-disabled", fetch, "/repo", checkSnapshotsEnabled)
    const { post, messages } = collect()

    await source.initialFetch(post)

    expect(calls).toEqual([])
    expect(messages).toEqual([
      { type: "loading", loading: true },
      { type: "notice", notice: "snapshots-disabled" },
      { type: "diffs", diffs: [] },
      { type: "loading", loading: false },
    ])
  })

  it("fetches normally when snapshots are enabled", async () => {
    const { fetch, calls } = recording([])
    const checkSnapshotsEnabled: SnapshotEnabledCheck = async () => true
    const source = new SessionDiffSource("s-enabled", fetch, "/repo", checkSnapshotsEnabled)
    const { post, messages } = collect()

    await source.initialFetch(post)

    expect(calls).toEqual([{ sessionID: "s-enabled", directory: "/repo" }])
    expect(messages.some((m) => m.type === "notice")).toBe(false)
    expect(messages.filter((m) => m.type === "diffs")).toHaveLength(1)
  })

  it("start() is a no-op when snapshots are disabled", async () => {
    const { fetch } = recording([])
    const checkSnapshotsEnabled: SnapshotEnabledCheck = async () => false
    const source = new SessionDiffSource("s-disabled-2", fetch, "/repo", checkSnapshotsEnabled)
    const { post } = collect()

    await source.initialFetch(post)
    const disposable = source.start(post)
    expect(typeof disposable.dispose).toBe("function")
    // Disposing must not throw even though no interval was scheduled.
    disposable.dispose()
  })
})
