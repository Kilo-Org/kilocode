import { describe, expect, it } from "bun:test"
import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import {
  CHECKPOINT_PREFIX,
  checkpointDescriptor,
  checkpointSourceId,
  createCheckpointDiffSource,
  type CheckpointDiffFetch,
} from "../../src/diff/sources/checkpoint"

const patch = ["diff --git a/foo.ts b/foo.ts", "--- a/foo.ts", "+++ b/foo.ts", "@@ -1 +1 @@", "-before", "+after"].join(
  "\n",
)

describe("checkpoint diff source", () => {
  it("fetches one immutable step interval", async () => {
    const calls: Parameters<CheckpointDiffFetch>[0][] = []
    const fetch: CheckpointDiffFetch = async (input) => {
      calls.push(input)
      return [{ file: "foo.ts", patch, additions: 1, deletions: 1, status: "modified" } satisfies SnapshotFileDiff]
    }
    const source = createCheckpointDiffSource("session", "message", "part", fetch, "/repo")

    const result = await source.fetch()

    expect(calls).toEqual([{ sessionID: "session", messageID: "message", partID: "part", directory: "/repo" }])
    expect(result.stopPolling).toBe(true)
    expect(result.diffs[0]).toMatchObject({ file: "foo.ts", before: "before\n", after: "after\n" })
  })

  it("encodes all checkpoint identities and disables file revert", () => {
    expect(checkpointSourceId("session", "message", "part")).toBe(`${CHECKPOINT_PREFIX}session:message:part`)
    expect(checkpointDescriptor("session", "message", "part").capabilities).toEqual({
      revert: false,
      comments: true,
    })
  })
})
