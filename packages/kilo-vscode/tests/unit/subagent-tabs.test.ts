import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { availableSubagents, createSubagentTabs } from "../../webview-ui/agent-manager/subagent-tabs"

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

  it("keeps tabs and active children separate for each context", () => {
    createRoot((dispose) => {
      const [context, setContext] = createSignal("worktree-a")
      const calls = {
        synced: [] as Array<[string, string | undefined]>,
        unsynced: [] as string[],
        shown: 0,
        hidden: 0,
      }
      const item = createSubagentTabs({
        current: () => "parent",
        context: () => context(),
        sync: (id, parent) => calls.synced.push([id, parent]),
        unsync: (id) => calls.unsynced.push(id),
        show: () => calls.shown++,
        hide: () => calls.hidden++,
      })

      item.open("child-a", "A", "parent-a")
      setContext("worktree-b")
      item.open("child-b", "B", "parent-b")

      expect(item.tabs().map((tab) => tab.id)).toEqual(["child-b"])
      expect(item.active()).toBe("child-b")
      setContext("worktree-a")
      expect(item.tabs().map((tab) => tab.id)).toEqual(["child-a"])
      expect(item.active()).toBe("child-a")
      expect(calls.synced).toEqual([
        ["child-a", "parent-a"],
        ["child-b", "parent-b"],
      ])
      dispose()
    })
  })

  it("restores Local Diff after worktree Subagents without competing visibility effects", () => {
    const script = `
      import { strict as assert } from "node:assert"
      import { batch, createRoot, createSignal } from "solid-js"
      import { createSubagentController } from "./webview-ui/agent-manager/subagent-tabs"
      import { createSidePanel } from "./webview-ui/agent-manager/side-panel-state"
      import { SidePanel } from "./webview-ui/agent-manager/side-panel-layout"
      const state = createRoot((dispose) => {
        const [project, activate] = createSignal("project")
        const [current, select] = createSignal("parent-local")
        const [selection, worktree] = createSignal("local")
        const panels = createSidePanel({ project, current, selection })
        const synced = []
        const unsynced = []
        const controller = createSubagentController({
          project, current, selection,
          parts: () => [],
          visible: () => panels.panel() === SidePanel.Subagents,
          show: () => panels.open(SidePanel.Subagents),
          hide: () => panels.close(SidePanel.Subagents),
          sync: (id) => synced.push(id),
          unsync: (id) => unsynced.push(id),
        })
        return { ...controller, panels, activate, synced, unsynced, dispose, switch: (id) => batch(() => {
          worktree(id)
          select("parent-" + id)
        }) }
      })
      state.panels.open(SidePanel.Diff)
      state.switch("worktree")
      assert.equal(state.panels.panel(), null)
      state.tabs.open("child-1")
      state.tabs.open("child-2")
      state.switch("local")
      assert.equal(state.panels.panel(), SidePanel.Diff)
      state.switch("untouched")
      assert.equal(state.panels.panel(), null)
      state.switch("worktree")
      assert.equal(state.panels.panel(), SidePanel.Subagents)
      assert.equal(state.tabs.active(), "child-2")
      assert.deepEqual(state.tabs.tabs().map(tab => tab.id), ["child-1", "child-2"])
      state.activate("other")
      assert.equal(state.panels.panel(), null)
      assert.deepEqual(state.tabs.tabs(), [])
      state.activate("project")
      assert.equal(state.panels.panel(), SidePanel.Subagents)
      assert.equal(state.tabs.active(), "child-2")
      assert.deepEqual(state.synced, ["child-1", "child-2"])
      assert.deepEqual(state.unsynced, [])
      state.toolbar.toggle()
      state.switch("local")
      assert.equal(state.panels.panel(), SidePanel.Diff)
      state.switch("worktree")
      assert.equal(state.panels.panel(), null)
      state.toolbar.toggle()
      assert.equal(state.panels.panel(), SidePanel.Subagents)
      state.tabs.close("child-2")
      state.tabs.close("child-1")
      state.switch("local")
      state.switch("worktree")
      assert.equal(state.panels.panel(), null)
      state.dispose()
    `
    const child = Bun.spawnSync([process.execPath, "--conditions=browser", "-e", script], {
      cwd: `${import.meta.dir}/../..`,
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
  })

  it("finds direct subagent sessions in task tool parts", () => {
    const tabs = availableSubagents([
      {
        id: "task-1",
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Inspect files", subagent_type: "explore" },
          output: "",
          title: "",
        },
        metadata: { sessionId: "child-1" },
      },
      {
        id: "task-2",
        type: "tool",
        tool: "task",
        state: { status: "running", input: { subagent_type: "general" } },
        metadata: { sessionId: "child-2" },
      },
    ])

    expect(tabs).toEqual([
      { id: "child-1", title: "Inspect files" },
      { id: "child-2", title: "general" },
    ])
  })
})
