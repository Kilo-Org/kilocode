import { describe, it, expect } from "bun:test"
import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import {
  createTurnDiffSource,
  turnDescriptor,
  turnSourceId,
  TURN_PREFIX,
  type TurnDiffFetch,
} from "../../src/diff/sources/turn"

type FetchCall = { sessionID: string; messageID: string; directory?: string }

function recording(result: SnapshotFileDiff[] | Error): { fetch: TurnDiffFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetch: TurnDiffFetch = async (params) => {
    calls.push(params)
    if (result instanceof Error) throw result
    return result
  }
  return { fetch, calls }
}

const samplePatch = [
  "diff --git a/foo.ts b/foo.ts",
  "--- a/foo.ts",
  "+++ b/foo.ts",
  "@@ -1,1 +1,1 @@",
  "-old",
  "+new",
].join("\n")

describe("createTurnDiffSource.fetch", () => {
  it("calls the fetch with sessionID + messageID + directory", async () => {
    const { fetch, calls } = recording([])
    const source = createTurnDiffSource("sess", "msg", fetch, "/repo")

    await source.fetch()

    expect(calls).toEqual([{ sessionID: "sess", messageID: "msg", directory: "/repo" }])
  })

  it("returns diffs with stopPolling=true so the controller skips polling", async () => {
    const { fetch } = recording([
      { file: "foo.ts", patch: samplePatch, additions: 1, deletions: 1, status: "modified" },
    ])
    const source = createTurnDiffSource("sess", "msg", fetch)

    const result = await source.fetch()

    expect(result.stopPolling).toBe(true)
    expect(result.notice).toBeUndefined()
    expect(result.diffs).toHaveLength(1)
    expect(result.diffs[0]!.file).toBe("foo.ts")
    expect(result.diffs[0]!.before).toBe("old\n")
    expect(result.diffs[0]!.after).toBe("new\n")
  })

  it("propagates underlying fetch errors", async () => {
    const { fetch } = recording(new Error("backend unavailable"))
    const source = createTurnDiffSource("sess", "msg", fetch)

    await expect(source.fetch()).rejects.toThrow("backend unavailable")
  })

  it("calls fetch without directory when workspaceRoot is not given", async () => {
    const { fetch, calls } = recording([])
    const source = createTurnDiffSource("sess", "msg", fetch)

    await source.fetch()

    expect(calls).toEqual([{ sessionID: "sess", messageID: "msg", directory: undefined }])
  })
})

describe("turn source descriptor + id helpers", () => {
  it("encodes sessionId + messageId in the source id", () => {
    expect(turnSourceId("abc", "42")).toBe(`${TURN_PREFIX}abc:42`)
  })

  it("produces a descriptor with type='turn' and no revert capability", () => {
    const desc = turnDescriptor("abc", "42")
    expect(desc.id).toBe("turn:abc:42")
    expect(desc.type).toBe("turn")
    expect(desc.capabilities).toEqual({ revert: false, comments: true })
  })
})
