import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { applyRunStatus } from "../../webview-ui/agent-manager/project/run-status"
import { createProjectRegistry } from "../../webview-ui/agent-manager/project/registry"

const pending = (id: string) => id.startsWith("pending")

function setup(active: string) {
  let id = active
  const registry = createProjectRegistry({ persisted: {}, activeId: () => id })
  return {
    registry,
    set: (next: string) => (id = next),
    deps: { ensure: (pid: string) => registry.ensure(pid), active: () => registry.active() },
  }
}

describe("applyRunStatus", () => {
  it("routes project-stamped statuses to their own store", () =>
    createRoot((dispose) => {
      const { registry, set, deps } = setup("prj-a")
      registry.ensure("prj-b")

      expect(
        applyRunStatus(
          { type: "agentManager.runStatus", worktreeId: "local", state: "running", projectId: "prj-b" },
          deps,
        ),
      ).toBe(true)

      expect(registry.ensure("prj-b").runStatuses()["local"]?.state).toBe("running")
      expect(registry.active().runStatuses()["local"]).toBeUndefined()

      set("prj-b")
      expect(registry.active().runStatuses()["local"]?.state).toBe("running")
      dispose()
    }))

  it("routes unstamped statuses to the active store (legacy behavior)", () =>
    createRoot((dispose) => {
      const { registry, deps } = setup("prj-a")
      registry.ensure("prj-b")

      expect(applyRunStatus({ type: "agentManager.runStatus", worktreeId: "local", state: "running" }, deps)).toBe(true)

      expect(registry.active().runStatuses()["local"]?.state).toBe("running")
      expect(registry.ensure("prj-b").runStatuses()["local"]).toBeUndefined()
      dispose()
    }))

  it("ignores other message types", () =>
    createRoot((dispose) => {
      const { deps } = setup("prj-a")
      expect(applyRunStatus({ type: "agentManager.localStats" }, deps)).toBe(false)
      dispose()
    }))
})
