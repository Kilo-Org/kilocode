import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { SidePanel } from "../webview-ui/agent-manager/side-panel-layout"
import { createSidePanel, sideHostNeeded } from "../webview-ui/agent-manager/side-panel-state"

describe("documents side panel", () => {
  it("opens and restores per worktree", () => {
    createRoot((dispose) => {
      const [selection, setSelection] = createSignal<string | null>("wt-a")
      const panels = createSidePanel({ project: () => "project-a", selection, current: () => undefined })

      panels.open(SidePanel.Documents)
      expect(panels.panel()).toBe(SidePanel.Documents)

      setSelection("wt-b")
      expect(panels.panel()).toBeNull()

      setSelection("wt-a")
      expect(panels.panel()).toBe(SidePanel.Documents)

      panels.close(SidePanel.Documents)
      expect(panels.panel()).toBeNull()
      dispose()
    })
  })

  it("keeps the side host mounted while documents are open", () => {
    expect(sideHostNeeded(SidePanel.Documents, false, 0, 0)).toBe(true)
    expect(sideHostNeeded(null, false, 0, 0)).toBe(false)
  })
})