import { describe, it, expect } from "bun:test"
import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import {
  createSessionDiffSource,
  sessionDescriptor,
  type SessionDiffFetch,
  type SnapshotEnabledCheck,
} from "../../src/diff/sources/session"

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

const modifiedPatch = [
  "diff --git a/foo.ts b/foo.ts",
  "--- a/foo.ts",
  "+++ b/foo.ts",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "+new",
  "",
].join("\n")

describe("createSessionDiffSource.fetch", () => {
  it("returns empty diffs for an empty session", async () => {
    const { fetch, calls } = recording([])
    const source = createSessionDiffSource("s1", fetch, "/repo")

    const result = await source.fetch()

    expect(calls).toEqual([{ sessionID: "s1", directory: "/repo" }])
    expect(result).toEqual({ diffs: [] })
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
      {
        file: "large.txt",
        patch: "",
        additions: 500,
        deletions: 200,
        status: "modified",
      },
    ]
    const { fetch } = recording(raw)
    const source = createSessionDiffSource("s2", fetch, "/repo")

    const result = await source.fetch()

    expect(result.diffs).toHaveLength(3)

    const foo = result.diffs[0]!
    expect(foo.file).toBe("foo.ts")
    expect(foo.before).toBe("keep\nold\n")
    expect(foo.after).toBe("keep\nnew\n")
    expect(foo.patch).toBe(modifiedPatch)
    expect(foo.additions).toBe(1)
    expect(foo.deletions).toBe(1)
    expect(foo.status).toBe("modified")
    expect(foo.tracked).toBe(true)
    expect(foo.generatedLike).toBe(false)
    expect(foo.summarized).toBe(false)

    const big = result.diffs[1]!
    expect(big.summarized).toBe(false)
    expect(big.before).toBe("")
    expect(big.after).toBe("")
    expect(result.diffs[2]?.summarized).toBe(true)
  })

  it("rebuilds text-backed SVG snapshot sides without sending them to Pierre", async () => {
    const before = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red"/></svg>'
    const after = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="blue"/></svg>'
    const patch = [
      "diff --git a/assets/banner.svg b/assets/banner.svg",
      "--- a/assets/banner.svg",
      "+++ b/assets/banner.svg",
      "@@ -1 +1 @@",
      `-${before}`,
      `+${after}`,
      "",
    ].join("\n")
    const { fetch } = recording([{ file: "assets/banner.svg", patch, additions: 1, deletions: 1, status: "modified" }])
    const result = await createSessionDiffSource("s-image", fetch, "/repo").fetch()

    expect(result.diffs[0]).toMatchObject({
      file: "assets/banner.svg",
      before: "",
      after: "",
      patch: "",
      kind: "image",
      summarized: false,
      image: {
        before: { mime: "image/svg+xml", data: Buffer.from(`${before}\n`).toString("base64") },
        after: { mime: "image/svg+xml", data: Buffer.from(`${after}\n`).toString("base64") },
      },
    })
  })

  it("reuses converted image details while the snapshot is unchanged", async () => {
    const { fetch } = recording([
      { file: "assets/banner.svg", patch: modifiedPatch, additions: 1, deletions: 1, status: "modified" },
    ])
    const source = createSessionDiffSource("s-image-cache", fetch, "/repo")
    const first = await source.fetch()
    const second = await source.fetch()

    expect(second.diffs).toBe(first.diffs)
  })

  it("marks binary snapshot images unavailable when their sides were not retained", async () => {
    const { fetch } = recording([
      { file: "assets/banner.png", patch: "", additions: 0, deletions: 0, status: "modified" },
    ])
    const result = await createSessionDiffSource("s-image", fetch, "/repo").fetch()

    expect(result.diffs[0]?.image).toEqual({})
  })

  it("propagates errors from the underlying fetch", async () => {
    const { fetch } = recording(new Error("network down"))
    const source = createSessionDiffSource("s3", fetch)

    await expect(source.fetch()).rejects.toThrow("network down")
  })

  it("calls fetch without directory when workspaceRoot is not given", async () => {
    const { fetch, calls } = recording([])
    const source = createSessionDiffSource("s4", fetch)

    await source.fetch()

    expect(calls).toEqual([{ sessionID: "s4", directory: undefined }])
  })
})

describe("createSessionDiffSource descriptor", () => {
  it("encodes the session id in the descriptor", () => {
    const source = createSessionDiffSource("abc", recording([]).fetch)
    expect(source.descriptor.id).toBe("session:abc")
    expect(source.descriptor.group).toBe("Session")
    expect(source.descriptor.capabilities).toEqual({ revert: false, comments: true })
  })

  it("exposes a stable descriptor helper", () => {
    expect(sessionDescriptor("xyz").id).toBe("session:xyz")
  })
})

describe("createSessionDiffSource snapshot check", () => {
  it("returns the snapshots-disabled notice and skips fetch when the check returns false", async () => {
    const { fetch, calls } = recording([
      { file: "foo.ts", patch: modifiedPatch, additions: 1, deletions: 1, status: "modified" },
    ])
    const checkSnapshotsEnabled: SnapshotEnabledCheck = async () => false
    const source = createSessionDiffSource("s-disabled", fetch, "/repo", checkSnapshotsEnabled)

    const result = await source.fetch()

    expect(calls).toEqual([])
    expect(result).toEqual({ diffs: [], notice: "snapshots-disabled", stopPolling: true })
  })

  it("caches the disabled state so subsequent fetches skip the config lookup", async () => {
    const { fetch } = recording([])
    let checks = 0
    const checkSnapshotsEnabled: SnapshotEnabledCheck = async () => {
      checks++
      return false
    }
    const source = createSessionDiffSource("s-cache", fetch, "/repo", checkSnapshotsEnabled)

    await source.fetch()
    await source.fetch()

    expect(checks).toBe(1)
  })

  it("fetches normally when snapshots are enabled", async () => {
    const { fetch, calls } = recording([])
    const checkSnapshotsEnabled: SnapshotEnabledCheck = async () => true
    const source = createSessionDiffSource("s-enabled", fetch, "/repo", checkSnapshotsEnabled)

    const result = await source.fetch()

    expect(calls).toEqual([{ sessionID: "s-enabled", directory: "/repo" }])
    expect(result.notice).toBeUndefined()
    expect(result.stopPolling).toBeUndefined()
  })
})
