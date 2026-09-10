import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createProjectRegistry } from "../../webview-ui/agent-manager/project/registry"

const pending = (id: string) => id.startsWith("pending")

function setup(active: string, persisted = {}) {
  let id = active
  const registry = createProjectRegistry({ persisted, activeId: () => id })
  return { registry, set: (next: string) => (id = next) }
}

describe("createProjectRegistry", () => {
  it("keeps each project's tabs to itself", () =>
    createRoot((dispose) => {
      const { registry, set } = setup("prj-a")
      registry.active().tabs.set(["ses_a1", "ses_a2"])
      set("prj-b")
      expect(registry.active().tabs.ids()).toEqual([])
      registry.active().tabs.set(["ses_b1"])
      set("prj-a")
      expect(registry.active().tabs.ids()).toEqual(["ses_a1", "ses_a2"])
      dispose()
    }))

  it("migrates legacy single-project tabs into the first real project", () =>
    createRoot((dispose) => {
      const { registry, set } = setup("single", { localSessionIDs: ["ses_old"] })
      expect(registry.active().tabs.ids()).toEqual(["ses_old"])
      set("prj-a")
      expect(registry.active().tabs.ids()).toEqual(["ses_old"])
      expect(registry.all().map((s) => s.id)).toEqual(["prj-a"])
      dispose()
    }))

  it("restores persisted buckets per project", () =>
    createRoot((dispose) => {
      const { registry, set } = setup("prj-b", { localTabs: { "prj-a": ["ses_a1"], "prj-b": ["ses_b1"] } })
      expect(registry.active().tabs.ids()).toEqual(["ses_b1"])
      set("prj-a")
      expect(registry.active().tabs.ids()).toEqual(["ses_a1"])
      dispose()
    }))

  it("migrates legacy tabs only once, into the first real project", () =>
    createRoot((dispose) => {
      const { registry, set } = setup("single", { localSessionIDs: ["ses_old"] })
      set("prj-a")
      expect(registry.active().tabs.ids()).toEqual(["ses_old"])
      set("prj-b")
      // "single" was consumed by the first migration, so prj-b stays empty.
      expect(registry.active().tabs.ids()).toEqual([])
      dispose()
    }))

  it("does not migrate single-project tabs over existing ones", () =>
    createRoot((dispose) => {
      const { registry, set } = setup("single", {
        localSessionIDs: ["ses_old"],
        localTabs: { "prj-a": ["ses_a1"] },
      })
      set("prj-a")
      expect(registry.active().tabs.ids()).toEqual(["ses_a1"])
      expect(registry.all().some((s) => s.id === "single")).toBe(true)
      dispose()
    }))

  it("bumps version when a store is created", () =>
    createRoot((dispose) => {
      const { registry } = setup("prj-a")
      const before = registry.version()
      registry.ensure("prj-b")
      expect(registry.version()).toBeGreaterThan(before)
      dispose()
    }))

  it("prunes stores for removed projects but keeps single", () =>
    createRoot((dispose) => {
      const { registry } = setup("prj-a")
      registry.ensure("prj-a")
      registry.ensure("prj-b")
      registry.ensure("single")
      registry.prune(new Set(["prj-a"]))
      expect(
        registry
          .all()
          .map((s) => s.id)
          .sort(),
      ).toEqual(["prj-a", "single"])
      dispose()
    }))

  it("keeps tab memory per project", () =>
    createRoot((dispose) => {
      const { registry, set } = setup("prj-a")
      registry.active().tabMemory.set("local", "ses_a1")
      set("prj-b")
      expect(registry.active().tabMemory.get("local")).toBeUndefined()
      registry.active().tabMemory.set("local", "ses_b1")
      set("prj-a")
      expect(registry.active().tabMemory.get("local")).toBe("ses_a1")
      dispose()
    }))

  it("strips pending drafts from durable output", () =>
    createRoot((dispose) => {
      const { registry } = setup("prj-a")
      registry.active().tabs.set(["ses_a1", "pending-1"])
      expect(registry.active().tabs.durable(pending)).toEqual(["ses_a1"])
      dispose()
    }))
})
