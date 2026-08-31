import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { LOCAL } from "../../webview-ui/agent-manager/navigate"
import { SidePanel } from "../../webview-ui/agent-manager/side-panel-layout"
import {
  ambientDecision,
  createAmbientSetup,
  keepTerminalStack,
  showTerminalStack,
} from "../../webview-ui/agent-manager/terminal/ambient"
import { createTerminalState } from "../../webview-ui/agent-manager/terminal/state"

describe("showTerminalStack", () => {
  it("hides the detail stack while the history view is open", () => {
    expect(showTerminalStack(true, "wt-1", false)).toBe(false)
    expect(showTerminalStack(true, null, false)).toBe(false)
  })

  it("shows the detail stack for a selected context with sessions", () => {
    expect(showTerminalStack(false, "wt-1", false)).toBe(true)
    expect(showTerminalStack(false, LOCAL, false)).toBe(true)
  })

  it("keeps the detail stack for a provisioning worktree with no sessions", () => {
    // The side terminal hosts the live Setup tab next to the empty state,
    // so the stack must render even when the context is empty.
    expect(showTerminalStack(false, "wt-1", true)).toBe(true)
  })

  it("shows the detail stack for an unassigned session", () => {
    // selection === null with a live session: contextEmpty is false, and
    // the stack hosts the read-only banner / chat. The old gate rendered
    // here; dropping this case blanks the pane and unmounts live xterms.
    expect(showTerminalStack(false, null, false)).toBe(true)
  })

  it("hides the detail stack when nothing is selected and the context is empty", () => {
    expect(showTerminalStack(false, null, true)).toBe(false)
  })
})

describe("keepTerminalStack", () => {
  it("keeps live terminals mounted under history", () => {
    expect(keepTerminalStack(true, "wt-1", false, 1)).toBe(true)
    expect(keepTerminalStack(true, null, true, 1)).toBe(true)
    expect(keepTerminalStack(true, "wt-1", false, 0)).toBe(false)
  })
})

describe("ambientDecision", () => {
  it("waits while setup is still running", () => {
    expect(ambientDecision(undefined, "wt-1", "wt-1")).toBe("wait")
    expect(ambientDecision({ state: "running", kind: "setup" }, "wt-1", "wt-1")).toBe("wait")
    expect(ambientDecision({ state: "stopping", kind: "setup" }, "wt-1", "wt-1")).toBe("wait")
  })

  it("hides the panel after a clean exit in the revealed context", () => {
    expect(ambientDecision({ state: "exited", exitCode: 0, kind: "setup" }, "wt-1", "wt-1")).toBe("hide")
  })

  it("keeps the panel when setup failed", () => {
    expect(ambientDecision({ state: "exited", exitCode: 1, kind: "setup" }, "wt-1", "wt-1")).toBe("keep")
    expect(ambientDecision({ state: "failed", kind: "setup" }, "wt-1", "wt-1")).toBe("keep")
  })

  it("keeps the panel when the user switched context before settle", () => {
    expect(ambientDecision({ state: "exited", exitCode: 0, kind: "setup" }, LOCAL, "wt-1")).toBe("keep")
  })
})

describe("createAmbientSetup tracking", () => {
  it("only closes the same owner's terminal after delayed setup completion", () => {
    const script = `
      import { strict as assert } from "node:assert"
      import { createRoot, createSignal } from "solid-js"
      import { createAmbientSetup } from "./webview-ui/agent-manager/terminal/ambient"
      import { createTerminalState } from "./webview-ui/agent-manager/terminal/state"
      import { createSidePanel } from "./webview-ui/agent-manager/side-panel-state"
      import { SidePanel } from "./webview-ui/agent-manager/side-panel-layout"
      for (const [panel, project, expected, concealed] of [
        [SidePanel.Terminal, "project", null],
        [SidePanel.Diff, "project", SidePanel.Diff],
        [SidePanel.Subagents, "project", SidePanel.Subagents],
        [SidePanel.Terminal, "other", SidePanel.Terminal],
        [SidePanel.Terminal, "project", SidePanel.Terminal, true],
      ]) {
        const state = createRoot((dispose) => {
          const [project, activate] = createSignal("project")
          const [hidden, conceal] = createSignal(false)
          const selection = () => "worktree"
          const context = () => project() + ":" + selection()
          const panels = createSidePanel({ project, selection, current: () => "parent", visible: () => !hidden() })
          const terms = createTerminalState(context)
          const ambient = createAmbientSetup({
            terms, selection: context, sidePanel: panels.selected,
            close: () => panels.close(SidePanel.Terminal),
          })
          return { panels, terms, ambient, activate, conceal, dispose }
        })
        const view = {
          terminalId: "script:setup", projectId: "project", worktreeId: "worktree",
          title: "Setup", kind: "setup", state: "running", wsUrl: "",
          font: { fontFamily: "monospace", fontSize: 12 },
        }
        state.terms.syncScripts([view])
        const terminal = state.terms.sides().at(0)
        if (concealed) {
          state.panels.open(SidePanel.Terminal)
          state.conceal(true)
          assert.equal(state.panels.panel(), null)
        }
        state.ambient.reveal("project:worktree", view.terminalId)
        if (concealed) assert.equal(state.ambient.pending(), undefined)
        state.conceal(false)
        state.panels.open(SidePanel.Terminal)
        state.activate(project)
        state.panels.open(panel)
        state.terms.syncScripts([{ ...view, state: "exited", exitCode: 0 }])
        assert.equal(state.panels.panel(), expected)
        assert.equal(state.terms.sides().at(0), terminal)
        state.dispose()
      }
    `
    const child = Bun.spawnSync([process.execPath, "--conditions=browser", "-e", script], {
      cwd: `${import.meta.dir}/../..`,
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
  })

  function scene(panelOpen: boolean) {
    const [selection] = createSignal<string | null>("wt-1")
    const [panel] = createSignal<SidePanel | null>(panelOpen ? SidePanel.Terminal : null)
    const terms = createTerminalState(selection)
    const ambient = createAmbientSetup({ terms, selection, sidePanel: panel, close: () => undefined })
    return ambient
  }

  it("remembers an ambient reveal only when the panel was closed", () => {
    createRoot((dispose) => {
      const closed = scene(false)
      closed.reveal("wt-1", "script:setup")
      expect(closed.pending()).toBeDefined()
      const open = scene(true)
      open.reveal("wt-1", "script:setup")
      expect(open.pending()).toBeUndefined()
      dispose()
    })
  })

  it("reveal and cancel drive the pending auto-hide", () => {
    createRoot((dispose) => {
      const ambient = scene(false)
      ambient.reveal("wt-1", "script:setup")
      expect(ambient.pending()).toEqual({ contextKey: "wt-1", terminalId: "script:setup" })
      ambient.cancel()
      expect(ambient.pending()).toBeUndefined()
      dispose()
    })
  })
})
