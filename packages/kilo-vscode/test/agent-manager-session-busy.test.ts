import { describe, expect, mock, test } from "bun:test"

const CLIENT_SOLID = "solid-js/dist/solid.js"
mock.module("solid-js", () => import(CLIENT_SOLID))

const { createRoot } = (await import(CLIENT_SOLID)) as {
  createRoot: <T>(fn: (dispose: () => void) => T) => T
}
const { activityOf } = await import("../webview-ui/agent-manager/v2/activity")
const { createSessionActivity } = await import("../webview-ui/agent-manager/project/session-busy")

describe("createSessionActivity", () => {
  test("keeps the host outcome for a managed session of an unselected worktree", () => {
    const seen = createRoot((dispose) => ({
      dispose,
      value: createSessionActivity({
        managed: () => [{ id: "s1", worktreeId: "w1" }],
        local: () => [],
        projects: () => ({
          p1: [
            {
              id: "s1",
              worktreeId: "w1",
              outcome: "failed",
              time: { created: 1, updated: 2, idle: 2, viewed: 0 },
            },
          ],
        }),
        active: () => "p1",
        activityFor: (id, info) => (info ? activityOf(info) : "idle"),
      }),
    }))
    expect(seen.value.project("p1", "w1")).toBe("error")
    seen.dispose()
  })
})
