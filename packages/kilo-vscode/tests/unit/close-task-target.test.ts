import { describe, expect, it } from "bun:test"
import { closeTaskTarget } from "../../src/commands/close-task-target"

const surfaces = { sidebar: "sidebar", tab: "tab", agentManager: "agentManager" }

describe("close-task command routing", () => {
  // WebviewPanel.active can still report an editor panel as active while the
  // user works in the sidebar. Closing tasks on Agent Manager stops sessions,
  // so a stale panel flag must never win over real focus.
  it("keeps a focused sidebar even while Agent Manager is the active panel", () => {
    expect(closeTaskTarget({ ...surfaces, tab: undefined, sidebarFocused: true })).toBe("sidebar")
  })

  it("keeps a focused sidebar even while a Kilo editor tab is active", () => {
    expect(closeTaskTarget({ ...surfaces, agentManager: undefined, sidebarFocused: true })).toBe("sidebar")
  })

  it("uses Agent Manager when its panel is active and the sidebar is unfocused", () => {
    expect(closeTaskTarget({ ...surfaces, tab: undefined, sidebarFocused: false })).toBe("agentManager")
  })

  // `active` is per editor group, so opening Agent Manager beside a Kilo tab
  // leaves both panels reporting active.
  it("prefers Agent Manager when a Kilo editor tab also reports active", () => {
    expect(closeTaskTarget({ ...surfaces, sidebarFocused: false })).toBe("agentManager")
  })

  it("uses the Kilo editor tab when one is active and the sidebar is unfocused", () => {
    expect(closeTaskTarget({ ...surfaces, agentManager: undefined, sidebarFocused: false })).toBe("tab")
  })

  it("falls back to the sidebar when no editor surface is active", () => {
    expect(closeTaskTarget({ sidebar: "sidebar", sidebarFocused: false })).toBe("sidebar")
  })
})
