import { describe, expect, it } from "bun:test"
import { batch, createRoot, createSignal } from "solid-js"
import { LOCAL } from "../../webview-ui/agent-manager/navigate"
import { SidePanel } from "../../webview-ui/agent-manager/side-panel-layout"
import { createSidePanel } from "../../webview-ui/agent-manager/side-panel-state"
import { switchProject } from "../../webview-ui/agent-manager/project/switch"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"
import { setupVisible, updateSetup, type SetupState } from "../../webview-ui/agent-manager/project/progress"
import type { AgentManagerWorktreeSetupMessage } from "../../webview-ui/src/types/messages"

function scene() {
  const [project, setProject] = createSignal<string | undefined>("project")
  const [selection, setSelection] = createSignal<string | null>(LOCAL)
  const [current, setCurrent] = createSignal<string | undefined>("parent")
  const [hidden, hide] = createSignal(false)
  const panels = createSidePanel({ project, selection, current, visible: () => !hidden() })
  const navigate = (selection: string | null, current?: string) =>
    batch(() => {
      setSelection(selection)
      setCurrent(current)
    })
  const activate = (id: string) =>
    switchProject({
      id,
      current: project,
      set: setProject,
      first: () => undefined,
      close: () => undefined,
      history: () => undefined,
    })
  return { panels, navigate, activate, select: setCurrent, hide }
}

function provisioning() {
  const stores = { first: createProjectStore("first"), second: createProjectStore("second") }
  const [project, activate] = createSignal<keyof typeof stores>("first")
  const [selection, select] = createSignal<string>(LOCAL)
  const [setup, setSetup] = createSignal<SetupState>({ active: false, message: "" })
  const panels = createSidePanel({
    project,
    selection,
    current: () => undefined,
    visible: (panel) =>
      panel !== SidePanel.Diff ||
      (!setupVisible(setup(), project(), selection()) &&
        stores[project()].busy().get(selection())?.reason !== "setting-up"),
  })
  const receive = (status: AgentManagerWorktreeSetupMessage["status"], id?: string, owner = project()) =>
    setSetup((state) =>
      updateSetup(
        stores[owner],
        state,
        { type: "agentManager.worktreeSetup", status, worktreeId: id, projectId: owner, message: status },
        project(),
        selection(),
      ),
    )
  return { panels, setup, select, activate, receive, stores }
}

describe("Agent Manager panel ownership", () => {
  it.each([
    [SidePanel.Diff, true],
    [SidePanel.PR, true],
    [SidePanel.Terminal, true],
    [SidePanel.Documents, true],
    [SidePanel.Subagents, false],
    [SidePanel.EditPreview, false],
    [SidePanel.Browser, false],
  ] as const)("retains %s in its owner without carrying it to other contexts", (panel, shared) => {
    createRoot((dispose) => {
      const state = scene()
      state.panels.open(panel)
      state.select("sibling")
      expect(state.panels.panel()).toBe(shared ? panel : null)
      state.select("parent")
      expect(state.panels.panel()).toBe(panel)
      state.navigate("worktree", "other")
      expect(state.panels.panel()).toBeNull()
      state.navigate(LOCAL, "parent")
      expect(state.panels.panel()).toBe(panel)
      state.activate("other")
      expect(state.panels.panel()).toBeNull()
      state.panels.open(SidePanel.Documents)
      state.activate("project")
      expect(state.panels.panel()).toBe(panel)
      state.panels.close()
      state.activate("other")
      state.activate("project")
      expect(state.panels.panel()).toBeNull()
      dispose()
    })
  })

  it("lets session panels override the worktree choice until that session opens a worktree panel", () => {
    createRoot((dispose) => {
      const state = scene()
      state.panels.open(SidePanel.Diff)
      state.panels.open(SidePanel.Subagents)
      state.select("sibling")
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      state.panels.open(SidePanel.EditPreview)
      state.select("parent")
      expect(state.panels.panel()).toBe(SidePanel.Subagents)
      state.panels.open(SidePanel.Documents)
      state.select("sibling")
      expect(state.panels.panel()).toBe(SidePanel.EditPreview)
      state.select("third")
      expect(state.panels.panel()).toBe(SidePanel.Documents)
      state.panels.close()
      state.select("sibling")
      expect(state.panels.panel()).toBe(SidePanel.EditPreview)
      state.select("parent")
      expect(state.panels.panel()).toBeNull()
      dispose()
    })
  })

  it.each([SidePanel.Subagents, SidePanel.EditPreview, SidePanel.Browser])(
    "closing %s suppresses the underlying panel only for its session",
    (panel) => {
      createRoot((dispose) => {
        const state = scene()
        state.panels.open(SidePanel.Diff)
        state.panels.open(panel)
        state.panels.toggle(panel)
        expect(state.panels.panel()).toBeNull()
        state.select("sibling")
        expect(state.panels.panel()).toBe(SidePanel.Diff)
        state.select("parent")
        expect(state.panels.panel()).toBeNull()
        state.panels.open(SidePanel.Terminal)
        expect(state.panels.panel()).toBe(SidePanel.Terminal)
        state.panels.close(panel)
        expect(state.panels.panel()).toBe(SidePanel.Terminal)
        dispose()
      })
    },
  )

  it.each(Object.values(SidePanel))("temporarily hides %s without changing its remembered selection", (panel) => {
    createRoot((dispose) => {
      const state = scene()
      state.panels.open(panel)
      state.hide(true)
      expect(state.panels.panel()).toBeNull()
      state.navigate("worktree", "other")
      state.navigate(LOCAL, "parent")
      state.hide(false)
      expect(state.panels.panel()).toBe(panel)
      dispose()
    })
  })

  it("restores Local Diff while the new worktree is still setting up", () => {
    createRoot((dispose) => {
      const state = provisioning()
      state.panels.open(SidePanel.Diff)
      state.receive("creating")
      expect(state.setup().selection).toBe(LOCAL)
      expect(state.panels.panel()).toBeNull()
      state.select("existing")
      state.panels.open(SidePanel.Diff)
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      state.select(LOCAL)
      state.receive("creating", "new-worktree")
      expect(state.setup().selection).toBeUndefined()
      state.select("new-worktree")
      state.panels.open(SidePanel.Diff)
      expect(state.panels.panel()).toBeNull()
      state.select(LOCAL)
      expect(state.setup().active).toBe(true)
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      state.select("new-worktree")
      state.panels.open(SidePanel.Terminal)
      expect(state.panels.panel()).toBe(SidePanel.Terminal)
      state.receive("ready", "new-worktree")
      state.select(LOCAL)
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      dispose()
    })
  })

  it.each([
    ["ready", "worktree"],
    ["error", "worktree"],
    ["ready", undefined],
    ["error", undefined],
  ] as const)("clears an inactive project's matching %s setup with id %s before returning", (status, id) => {
    createRoot((dispose) => {
      const state = provisioning()
      state.select("worktree")
      state.panels.open(SidePanel.Diff)
      state.select(LOCAL)
      state.panels.open(SidePanel.Diff)
      state.receive("creating")
      state.activate("second")
      state.panels.open(SidePanel.Diff)
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      state.receive("creating", "worktree", "first")
      expect(state.setup().selection).toBeUndefined()
      state.activate("first")
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      state.select("worktree")
      expect(state.panels.panel()).toBeNull()
      state.activate("second")
      state.receive(status, id, "first")
      expect(state.setup().active).toBe(false)
      expect(state.stores.first.busy().has("worktree")).toBe(false)
      state.activate("first")
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      state.select(LOCAL)
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      dispose()
    })
  })

  it.each(["first", "second"] as const)("does not clear a different concurrent setup in %s", (owner) => {
    createRoot((dispose) => {
      const state = provisioning()
      state.select("first-worktree")
      state.panels.open(SidePanel.Diff)
      state.receive("creating", "first-worktree")
      state.activate(owner)
      state.select("second-worktree")
      state.panels.open(SidePanel.Diff)
      state.receive("creating", "second-worktree")
      const pending = state.setup()
      state.activate("first")
      state.select("first-worktree")
      expect(state.panels.panel()).toBeNull()
      state.activate(owner)
      state.select("second-worktree")
      state.receive("ready", "first-worktree", "first")
      expect(state.setup()).toBe(pending)
      expect(state.stores[owner].busy().has("second-worktree")).toBe(true)
      expect(state.panels.panel()).toBeNull()
      state.receive("ready", "second-worktree")
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      dispose()
    })
  })

  it("clears an ID-less setup failure after switching projects", () => {
    createRoot((dispose) => {
      const state = provisioning()
      state.panels.open(SidePanel.Diff)
      state.receive("creating")
      state.activate("second")
      state.receive("error", undefined, "first")
      expect(state.setup().active).toBe(false)
      state.activate("first")
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      dispose()
    })
  })

  it.each([undefined, "project"])("clears known setup ownership when completion omits both IDs in %s", (project) => {
    createRoot((dispose) => {
      for (const status of ["ready", "error"] as const) {
        const store = createProjectStore(project ?? "single")
        const state = updateSetup(
          store,
          { active: false, message: "" },
          {
            type: "agentManager.worktreeSetup",
            projectId: project,
            worktreeId: "worktree",
            status: "creating",
            message: "",
          },
          project,
          "worktree",
        )
        const next = updateSetup(
          store,
          state,
          { type: "agentManager.worktreeSetup", status, message: status },
          project,
          "other",
        )
        expect(store.busy().has("worktree")).toBe(false)
        expect(next.worktreeId).toBe("worktree")
        expect(setupVisible(next, project, "other")).toBe(false)
        expect(setupVisible(next, project, "worktree")).toBe(status === "error")
      }
      dispose()
    })
  })

  it("supports empty and unassigned contexts without inventing a session owner", () => {
    createRoot((dispose) => {
      const state = scene()
      state.navigate(LOCAL)
      state.panels.open(SidePanel.Terminal)
      state.panels.open(SidePanel.Subagents)
      expect(state.panels.panel()).toBe(SidePanel.Terminal)
      state.navigate(null)
      expect(state.panels.panel()).toBeNull()
      state.panels.open(SidePanel.EditPreview)
      expect(state.panels.panel()).toBeNull()
      state.panels.open(SidePanel.Documents)
      state.navigate(LOCAL)
      expect(state.panels.panel()).toBe(SidePanel.Terminal)
      state.navigate(null)
      expect(state.panels.panel()).toBe(SidePanel.Documents)
      dispose()
    })
  })

  it("wires the applied project and preview payloads to the single panel controller", async () => {
    const app = await Bun.file(`${import.meta.dir}/../../webview-ui/agent-manager/AgentManagerApp.tsx`).text()
    expect(app).toContain("const panels = createSidePanel({\n    project: currentProjectId,")
    expect(app).toContain("const sidePanel = panels.panel")
    expect(app).toContain("sidePanel: panels.selected")
    expect(app).toContain("context: panels.session")
    expect(app).toContain("!setupVisible(setup(), currentProjectId(), selection())")
    expect(app).toContain('current === next ? { active: false, message: "" } : current')
    const start = app.indexOf('if (msg.type === "agentManager.worktreeSetup")')
    const handler = app.slice(start, app.indexOf('if (msg.type === "agentManager.importResult"', start))
    expect(handler.indexOf("updateSetup(")).toBeGreaterThan(-1)
    expect(handler.indexOf("updateSetup(")).toBeLessThan(handler.indexOf("if (!isActivePayload("))
    expect(app).not.toContain("if (sidePanel() === SidePanel.Diff) panels.close()")
    expect(app).not.toContain("setSidePanel")
    expect(app).not.toContain("subagents.reset")
    expect(app).not.toContain("createEditPreviewContextGuard")
  })
})
