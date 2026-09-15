import { describe, expect, it } from "bun:test"
import { batch, createRoot, createSignal } from "solid-js"
import { SidePanel } from "../../webview-ui/agent-manager/side-panel-layout"
import { createSidePanel } from "../../webview-ui/agent-manager/side-panel-state"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"
import { setupVisible, updateSetup } from "../../webview-ui/agent-manager/project/progress"

describe("Agent Manager panel ownership", () => {
  it("opens and closes the Integrated Browser before a session exists", () => {
    createRoot((dispose) => {
      const panels = createSidePanel({ project: () => "project", selection: () => "local", current: () => undefined })
      panels.toggle(SidePanel.Browser)
      expect(panels.panel()).toBe(SidePanel.Browser)
      expect(panels.session()).toBeUndefined()
      panels.toggle(SidePanel.Browser)
      expect(panels.panel()).toBeNull()
      panels.open(SidePanel.Browser)
      panels.open(SidePanel.Documents)
      expect(panels.panel()).toBe(SidePanel.Documents)
      dispose()
    })
  })

  it("keeps the empty browser separate from real sessions, projects, and worktrees", () => {
    createRoot((dispose) => {
      const [project, activate] = createSignal("project")
      const [selection, select] = createSignal("local")
      const [current, session] = createSignal<string>()
      const panels = createSidePanel({ project, selection, current })
      panels.open(SidePanel.Browser)
      select("worktree")
      expect(panels.panel()).toBeNull()
      select("local")
      activate("other")
      expect(panels.panel()).toBeNull()
      activate("project")
      expect(panels.panel()).toBe(SidePanel.Browser)
      session("real-session")
      expect(panels.panel()).toBeNull()
      panels.open(SidePanel.Browser)
      session("sibling")
      expect(panels.panel()).toBeNull()
      session("real-session")
      expect(panels.panel()).toBe(SidePanel.Browser)
      panels.close()
      session(undefined)
      expect(panels.panel()).toBe(SidePanel.Browser)
      dispose()
    })
  })

  it("does not let a closed draft browser hide a worktree panel after the session ends", () => {
    createRoot((dispose) => {
      const [current, session] = createSignal<string>()
      const panels = createSidePanel({ project: () => "project", selection: () => "local", current })
      panels.open(SidePanel.Browser)
      panels.close()
      expect(panels.panel()).toBeNull()
      session("real-session")
      panels.open(SidePanel.Diff)
      expect(panels.panel()).toBe(SidePanel.Diff)
      session(undefined)
      expect(panels.panel()).toBe(SidePanel.Diff)
      dispose()
    })
  })

  it("still requires a real session for other session-owned panels", () => {
    createRoot((dispose) => {
      const panels = createSidePanel({ project: () => "project", selection: () => "local", current: () => undefined })
      panels.open(SidePanel.Subagents)
      expect(panels.panel()).toBeNull()
      panels.open(SidePanel.EditPreview)
      expect(panels.panel()).toBeNull()
      dispose()
    })
  })

  it("restores Local Diff and session panels independently, including explicit closes", () => {
    createRoot((dispose) => {
      const [project, activate] = createSignal("project")
      const [selection, select] = createSignal("local")
      const [current, session] = createSignal("local-session")
      const panels = createSidePanel({ project, selection, current })
      const navigate = (worktree: string, parent: string) =>
        batch(() => {
          select(worktree)
          session(parent)
        })
      panels.open(SidePanel.Diff)
      navigate("worktree", "parent")
      expect(panels.panel()).toBeNull()
      panels.open(SidePanel.Subagents)
      session("sibling")
      expect(panels.panel()).toBeNull()
      panels.open(SidePanel.Documents)
      session("parent")
      expect(panels.panel()).toBe(SidePanel.Subagents)
      activate("other-project")
      expect(panels.panel()).toBeNull()
      activate("project")
      expect(panels.panel()).toBe(SidePanel.Subagents)
      navigate("local", "local-session")
      expect(panels.panel()).toBe(SidePanel.Diff)
      panels.close()
      navigate("worktree", "parent")
      expect(panels.panel()).toBe(SidePanel.Subagents)
      panels.close()
      session("sibling")
      expect(panels.panel()).toBe(SidePanel.Documents)
      session("parent")
      expect(panels.panel()).toBeNull()
      navigate("local", "local-session")
      expect(panels.panel()).toBeNull()
      dispose()
    })
  })

  it.each(["ready", "error"] as const)("clears ID-less %s setup completion for an inactive owner", (status) => {
    createRoot((dispose) => {
      const store = createProjectStore("project")
      const message = {
        type: "agentManager.worktreeSetup",
        projectId: "project",
        status: "creating",
        message: "",
      } as const
      const initial = updateSetup(store, { active: false, message: "" }, message, "project", "local")
      expect(setupVisible(initial, "project", "local")).toBe(true)
      const pending = updateSetup(store, initial, { ...message, worktreeId: "worktree" }, "project", "local")
      expect(setupVisible(pending, "project", "local")).toBe(false)
      expect(setupVisible(pending, "project", "worktree")).toBe(true)
      const done = updateSetup(store, pending, { ...message, status }, "other-project", "local")
      expect(done.active).toBe(false)
      expect(store.busy().has("worktree")).toBe(false)
      dispose()
    })
  })
})
