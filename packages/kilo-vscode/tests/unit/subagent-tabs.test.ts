import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSubagentTabs } from "../../webview-ui/agent-manager/subagent-tabs"

function scene() {
  const [current] = createSignal<string | undefined>("parent")
  const calls = {
    synced: [] as Array<[string, string | undefined]>,
    unsynced: [] as string[],
    shown: 0,
    hidden: 0,
  }
  const tabs = createSubagentTabs({
    current,
    sync: (id, parent) => calls.synced.push([id, parent]),
    unsync: (id) => calls.unsynced.push(id),
    show: () => calls.shown++,
    hide: () => calls.hidden++,
  })
  return { tabs, calls }
}

describe("Agent Manager subagent tabs", () => {
  it("opens multiple child sessions and syncs each to its parent", () => {
    createRoot((dispose) => {
      const item = scene()
      item.tabs.open("child-1", "First", "parent-1")
      item.tabs.open("child-2", "Second", "parent-2")

      expect(item.tabs.tabs().map((tab) => tab.id)).toEqual(["child-1", "child-2"])
      expect(item.tabs.active()).toBe("child-2")
      expect(item.calls.synced).toEqual([
        ["child-1", "parent-1"],
        ["child-2", "parent-2"],
      ])
      expect(item.calls.shown).toBe(2)
      dispose()
    })
  })

  it("closes the active tab onto its nearest survivor and hides when empty", () => {
    createRoot((dispose) => {
      const item = scene()
      item.tabs.open("one", "One")
      item.tabs.open("two", "Two")
      item.tabs.open("three", "Three")

      item.tabs.close("two")
      expect(item.tabs.tabs().map((tab) => tab.id)).toEqual(["one", "three"])
      expect(item.tabs.active()).toBe("three")

      item.tabs.close("three")
      item.tabs.close("one")
      expect(item.tabs.tabs()).toEqual([])
      expect(item.tabs.active()).toBeUndefined()
      expect(item.calls.unsynced).toEqual(["two", "three", "one"])
      expect(item.calls.hidden).toBe(1)
      dispose()
    })
  })

  it("supports Close Others and preserves the selected child", () => {
    createRoot((dispose) => {
      const item = scene()
      item.tabs.open("one")
      item.tabs.open("two")
      item.tabs.open("three")

      item.tabs.closeOthers("one")
      expect(item.tabs.tabs().map((tab) => tab.id)).toEqual(["one"])
      expect(item.tabs.active()).toBe("one")
      expect(item.calls.unsynced).toEqual(["two", "three"])
      expect(item.calls.shown).toBe(4)
      dispose()
    })
  })

  it("reorders tabs without changing the active child", () => {
    createRoot((dispose) => {
      const item = scene()
      item.tabs.open("one")
      item.tabs.open("two")
      item.tabs.open("three")
      item.tabs.select("two")

      item.tabs.reorder("three", "one")
      expect(item.tabs.tabs().map((tab) => tab.id)).toEqual(["three", "one", "two"])
      expect(item.tabs.active()).toBe("two")
      dispose()
    })
  })
})
