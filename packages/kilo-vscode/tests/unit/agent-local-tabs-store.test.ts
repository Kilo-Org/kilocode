import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createLocalTabs } from "../../webview-ui/agent-manager/local-tabs-store"

const pending = (id: string) => id.startsWith("pending-")

describe("createLocalTabs", () => {
  it("keeps each project's open tabs to itself", () =>
    createRoot((dispose) => {
      let project = "prj-a"
      const tabs = createLocalTabs(undefined, () => project)

      tabs.set(["ses_a1", "ses_a2"])
      expect(tabs.ids()).toEqual(["ses_a1", "ses_a2"])

      // Switching projects must not carry the previous project's tabs over.
      project = "prj-b"
      expect(tabs.ids()).toEqual([])

      tabs.set(["ses_b1"])
      expect(tabs.ids()).toEqual(["ses_b1"])

      project = "prj-a"
      expect(tabs.ids()).toEqual(["ses_a1", "ses_a2"])
      dispose()
    }))

  it("applies updater functions to the active project only", () =>
    createRoot((dispose) => {
      let project = "prj-a"
      const tabs = createLocalTabs(undefined, () => project)
      tabs.set(["ses_a1"])
      project = "prj-b"
      tabs.set((prev) => [...prev, "ses_b1"])

      expect(tabs.ids()).toEqual(["ses_b1"])
      project = "prj-a"
      expect(tabs.ids()).toEqual(["ses_a1"])
      dispose()
    }))

  it("keeps the same array reference when the value does not change", () =>
    createRoot((dispose) => {
      const tabs = createLocalTabs(undefined, () => "prj-a")
      tabs.set(["ses_a1"])
      const first = tabs.ids()
      tabs.set((prev) => prev)
      expect(tabs.ids()).toBe(first)
      dispose()
    }))

  it("migrates the legacy single-project list into the single bucket", () =>
    createRoot((dispose) => {
      let project = "single"
      const tabs = createLocalTabs({ localSessionIDs: ["ses_old"] }, () => project)
      expect(tabs.ids()).toEqual(["ses_old"])
      project = "prj-a"
      expect(tabs.ids()).toEqual([])
      dispose()
    }))

  it("restores persisted per-project buckets", () =>
    createRoot((dispose) => {
      let project = "prj-b"
      const tabs = createLocalTabs({ localTabs: { "prj-a": ["ses_a1"], "prj-b": ["ses_b1"] } }, () => project)
      expect(tabs.ids()).toEqual(["ses_b1"])
      project = "prj-a"
      expect(tabs.ids()).toEqual(["ses_a1"])
      dispose()
    }))

  it("strips ephemeral tabs from every bucket before persisting", () =>
    createRoot((dispose) => {
      let project = "prj-a"
      const tabs = createLocalTabs(undefined, () => project)
      tabs.set(["ses_a1", "pending-1"])
      project = "prj-b"
      tabs.set(["pending-2", "ses_b1"])

      expect(tabs.durable(pending)).toEqual({ "prj-a": ["ses_a1"], "prj-b": ["ses_b1"] })
      dispose()
    }))
})
