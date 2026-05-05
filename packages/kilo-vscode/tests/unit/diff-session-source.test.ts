import { describe, it, expect } from "bun:test"
import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import {
  POLL_INTERVAL_MS,
  SessionDiffSource,
  type SessionDiffFetch,
  type SnapshotEnabledCheck,
} from "../../src/diff/sources/session"
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

function scripted(results: Array<SnapshotFileDiff[] | Error>): {
  fetch: SessionDiffFetch
  calls: FetchCall[]
} {
  const calls: FetchCall[] = []
  let i = 0
  const fetch: SessionDiffFetch = async (params) => {
    calls.push(params)
    const next = results[Math.min(i, results.length - 1)]
    i++
    if (next instanceof Error) throw next
    return next ?? []
  }
  return { fetch, calls }
}

function collect(): { post: (msg: DiffSourceMessage) => void; messages: DiffSourceMessage[] } {
  const messages: DiffSourceMessage[] = []
  return { post: (msg) => messages.push(msg), messages }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
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

const modifiedPatchV2 = [
  "diff --git a/foo.ts b/foo.ts",
  "--- a/foo.ts",
  "+++ b/foo.ts",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "+newer",
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
    expect(foo.before).toBe("keep\nold")
    expect(foo.after).toBe("keep\nnew")
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
  it("start returns a Disposable", () => {
    const { fetch } = recording([])
    const source = new SessionDiffSource("s5", fetch)
    const { post } = collect()

    const d = source.start?.(post)
    expect(d).toBeDefined()
    d?.dispose()
    source.dispose()
  })

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

describe("SessionDiffSource polling", () => {
  function makeFast(source: SessionDiffSource, intervalMs = 10) {
    // Use timers override via Bun's real timers to set a 10ms interval
    void source
    void intervalMs
  }
  void makeFast

  it("polls and posts new diffs only when the hash changes", async () => {
    const fileA: SnapshotFileDiff = {
      file: "foo.ts",
      patch: modifiedPatch,
      additions: 1,
      deletions: 1,
      status: "modified",
    }
    const fileB: SnapshotFileDiff = {
      file: "foo.ts",
      patch: modifiedPatchV2,
      additions: 2,
      deletions: 1,
      status: "modified",
    }

    const { fetch, calls } = scripted([[fileA], [fileA], [fileB], [fileB]])
    const source = new SessionDiffSource("poll-1", fetch, "/repo")
    const { post, messages } = collect()

    await source.initialFetch(post)
    const initialDiffs = messages.filter((m) => m.type === "diffs").length
    expect(initialDiffs).toBe(1)

    // Invoke the private poll directly for deterministic testing.
    const poll = (source as unknown as { poll(p: typeof post): Promise<void> }).poll.bind(source)

    await poll(post)
    // second call returns identical data → no new "diffs" message
    expect(messages.filter((m) => m.type === "diffs").length).toBe(1)

    await poll(post)
    // third call returns different patch/additions → hash changes → "diffs" posted
    expect(messages.filter((m) => m.type === "diffs").length).toBe(2)

    await poll(post)
    // fourth call returns same as third → no new message
    expect(messages.filter((m) => m.type === "diffs").length).toBe(2)

    expect(calls.length).toBe(4)
    source.dispose()
  })

  it("swallows errors during poll without posting error or loading", async () => {
    const ok: SnapshotFileDiff[] = [
      { file: "foo.ts", patch: modifiedPatch, additions: 1, deletions: 1, status: "modified" },
    ]
    const { fetch } = scripted([ok, new Error("transient boom"), ok])
    const source = new SessionDiffSource("poll-2", fetch, "/repo")
    const { post, messages } = collect()

    await source.initialFetch(post)
    const baseline = messages.length

    const poll = (source as unknown as { poll(p: typeof post): Promise<void> }).poll.bind(source)
    await poll(post)

    // After a failing poll: no new messages should be posted at all.
    expect(messages.length).toBe(baseline)
    expect(messages.some((m) => m.type === "error")).toBe(false)
    // loading=false should not be re-posted by the poll path
    const loadingFalseCount = messages.filter((m) => m.type === "loading" && m.loading === false).length
    expect(loadingFalseCount).toBe(1) // only from initialFetch

    source.dispose()
  })

  it("stops polling when the disposable from start() is disposed", async () => {
    const { fetch, calls } = recording([])
    const source = new SessionDiffSource("poll-3", fetch)
    const { post } = collect()

    const d = source.start(post)
    // Verify disposing clears it without waiting for the interval to complete
    d.dispose()

    await wait(30)
    // No fetch calls expected because interval hasn't fired yet and is now cleared.
    expect(calls.length).toBe(0)
    source.dispose()
  })

  it("discards a poll result that arrives after dispose", async () => {
    let resolveFetch: (value: SnapshotFileDiff[]) => void = () => {}
    const pending = new Promise<SnapshotFileDiff[]>((resolve) => {
      resolveFetch = resolve
    })
    const calls: FetchCall[] = []
    const fetch: SessionDiffFetch = async (params) => {
      calls.push(params)
      return pending
    }
    const source = new SessionDiffSource("poll-4", fetch, "/repo")
    const { post, messages } = collect()

    const poll = (source as unknown as { poll(p: typeof post): Promise<void> }).poll.bind(source)
    const running = poll(post)

    // Dispose while the fetch is still in flight.
    source.dispose()

    // Now resolve the in-flight fetch — the result must be discarded.
    resolveFetch([{ file: "foo.ts", patch: modifiedPatch, additions: 1, deletions: 1, status: "modified" }])
    await running

    expect(messages.length).toBe(0)
  })

  it("start() schedules polling via setInterval at 2500ms", () => {
    const { fetch } = recording([])
    const source = new SessionDiffSource("poll-5", fetch)
    const { post } = collect()

    const originalSetInterval = globalThis.setInterval
    const originalClearInterval = globalThis.clearInterval
    const captured: { handler: () => void; ms: number }[] = []
    const cleared: unknown[] = []
    globalThis.setInterval = ((handler: () => void, ms: number) => {
      captured.push({ handler, ms })
      return 42 as unknown as ReturnType<typeof setInterval>
    }) as typeof setInterval
    globalThis.clearInterval = ((id: unknown) => {
      cleared.push(id)
    }) as typeof clearInterval

    try {
      const d = source.start(post)
      expect(captured.length).toBe(1)
      expect(captured[0]!.ms).toBe(POLL_INTERVAL_MS)

      d.dispose()
      expect(cleared).toEqual([42])
    } finally {
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
      source.dispose()
    }
  })
})
