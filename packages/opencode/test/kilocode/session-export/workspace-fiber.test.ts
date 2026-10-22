import { describe, test, expect } from "bun:test"
import { startBaselineFiber, startDeltaFiber } from "@/kilocode/session-export/workspace-fiber"

describe("workspace fiber", () => {
  test("emits stable consistency when token arrives in time", async () => {
    const dispatched: unknown[] = []
    await startBaselineFiber({
      sessionId: "s1",
      rootSessionId: "s1",
      timeoutMs: 100,
      now: () => 0,
      syncSeq: () => 1,
      agentVersion: "v0",
      requestSnapshot: async () => ({ snapshotId: "snap-1", files: [{ path: "src/a.ts", kind: "file", size: 10 }] }),
      dispatch: (event) => dispatched.push(event),
    })
    const env = dispatched[0] as { type: string; consistency: string; files: { path: string }[] }
    expect(env.type).toBe("workspace_baseline_completed")
    expect(env.consistency).toBe("stable")
    expect(env.files[0].path).toBe("src/a.ts")
  })

  test("baseline event preserves capture metadata", async () => {
    const dispatched: unknown[] = []
    await startBaselineFiber({
      sessionId: "s1",
      rootSessionId: "s1",
      timeoutMs: 100,
      now: () => 0,
      syncSeq: () => 1,
      agentVersion: "v0",
      requestSnapshot: async () => ({
        snapshotId: "snap-1",
        files: [],
        capture: {
          root: "/repo",
          mode: "git-tracked-and-untracked",
          fileCount: 0,
          totalBytes: 0,
          omittedCountsByReason: {},
          truncated: false,
        },
      }),
      dispatch: (event) => dispatched.push(event),
    })
    expect(
      (
        dispatched[0] as {
          capture?: {
            root: string
            mode: string
            fileCount: number
            totalBytes: number
            omittedCountsByReason: Record<string, number>
            truncated: boolean
          }
        }
      ).capture,
    ).toEqual({
      root: "/repo",
      mode: "git-tracked-and-untracked",
      fileCount: 0,
      totalBytes: 0,
      omittedCountsByReason: {},
      truncated: false,
    })
  })

  test("emits missing at timeout then eventual when snapshot arrives", async () => {
    const dispatched: unknown[] = []
    await startBaselineFiber({
      sessionId: "s1",
      rootSessionId: "s1",
      timeoutMs: 30,
      now: () => 0,
      syncSeq: () => 1,
      agentVersion: "v0",
      requestSnapshot: () =>
        new Promise((resolve) => setTimeout(() => resolve({ snapshotId: "snap-1", files: [] }), 60)),
      dispatch: (event) => dispatched.push(event),
    })
    expect((dispatched[0] as { consistency: string }).consistency).toBe("missing")
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(dispatched.map((item) => (item as { consistency?: string }).consistency)).toEqual(["missing", "eventual"])
  })

  test("emits missing consistency when snapshot fails entirely", async () => {
    const dispatched: unknown[] = []
    await startBaselineFiber({
      sessionId: "s1",
      rootSessionId: "s1",
      timeoutMs: 30,
      now: () => 0,
      syncSeq: () => 1,
      agentVersion: "v0",
      requestSnapshot: async () => {
        throw new Error("snapshot failed")
      },
      dispatch: (event) => dispatched.push(event),
    })
    expect((dispatched[0] as { consistency: string }).consistency).toBe("missing")
  })

  test("delta fiber emits trigger session_close", async () => {
    const dispatched: unknown[] = []
    await startDeltaFiber({
      sessionId: "s1",
      rootSessionId: "s1",
      trigger: "session_close",
      prevSnapshotHash: "h0",
      now: () => 0,
      syncSeq: () => 1,
      agentVersion: "v0",
      requestDiff: async () => ({
        snapshotHash: "h1",
        diff: [{ path: "src/a.ts", status: "modified", patchChunkIds: [] }],
      }),
      dispatch: (event) => dispatched.push(event),
    })
    expect((dispatched[0] as { trigger: string }).trigger).toBe("session_close")
  })

  test("delta fiber skips empty diffs while returning snapshot", async () => {
    const dispatched: unknown[] = []
    let seq = 0
    const snapshot = await startDeltaFiber({
      sessionId: "s1",
      rootSessionId: "s1",
      trigger: "turn_end",
      prevSnapshotHash: "h0",
      now: () => 0,
      syncSeq: () => seq++,
      agentVersion: "v0",
      requestDiff: async () => ({ snapshotHash: "h1", diff: [] }),
      dispatch: (event) => dispatched.push(event),
    })
    expect(snapshot).toBe("h1")
    expect(dispatched.length).toBe(0)
    expect(seq).toBe(0)
  })
})
