import { describe, expect, test } from "bun:test"
import { mapKiloRuntimeActivity, mapKiloRuntimeStatus } from "../kilo-status"
import { resumeDecision } from "../resume"
import { assertSessionIsolation } from "../lifecycle"

describe("kilo runtime status mapping", () => {
  test("maps idle to a safe deliver/resume boundary", () => {
    expect(mapKiloRuntimeStatus("idle")).toBe("reachable")
    expect(resumeDecision(mapKiloRuntimeStatus("idle"))).toBe("resume")
    expect(mapKiloRuntimeActivity("idle")).toBe("idle")
  })

  test("does not deliver while busy or retrying", () => {
    expect(resumeDecision(mapKiloRuntimeStatus("busy"))).toBe("wait")
    expect(resumeDecision(mapKiloRuntimeStatus("retry"))).toBe("wait")
  })

  test("treats offline as paused so restore can resume", () => {
    expect(mapKiloRuntimeStatus("offline")).toBe("paused")
    expect(resumeDecision(mapKiloRuntimeStatus("offline"))).toBe("resume")
  })
})

describe("session isolation", () => {
  test("rejects an isolated session at the workspace root", () => {
    expect(() =>
      assertSessionIsolation({
        workspaceRoot: "C:\\repo",
        sessionDirectory: "C:\\repo",
        isolated: true,
      }),
    ).toThrow("workspace root")
  })

  test("allows a worktree path under the root", () => {
    expect(() =>
      assertSessionIsolation({
        workspaceRoot: "C:\\repo",
        sessionDirectory: "C:\\repo\\.kilo\\worktrees\\wt-1",
        isolated: true,
      }),
    ).not.toThrow()
  })

  test("rejects an isolated session at the workspace root ignoring Windows path casing", () => {
    const mixed = {
      workspaceRoot: "C:\\Repo",
      sessionDirectory: "C:\\repo",
      isolated: true,
    }
    if (process.platform === "win32") {
      expect(() => assertSessionIsolation(mixed)).toThrow("workspace root")
    } else {
      expect(() => assertSessionIsolation(mixed)).not.toThrow()
    }
  })
})
