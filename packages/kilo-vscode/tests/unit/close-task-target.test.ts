import { describe, expect, it } from "bun:test"
import { closeTaskTarget, SurfaceFocus } from "../../src/commands/close-task-target"

const surfaces = { sidebar: "sidebar", tab: "tab", agentManager: "agentManager" }

describe("close-task command routing", () => {
  it("uses the surface the user last worked in", () => {
    expect(closeTaskTarget({ ...surfaces, focused: "sidebar" })).toBe("sidebar")
    expect(closeTaskTarget({ ...surfaces, focused: "agentManager" })).toBe("agentManager")
    expect(closeTaskTarget({ ...surfaces, focused: "tab" })).toBe("tab")
  })

  // WebviewPanel.active is tracked per editor group, so Agent Manager and a Kilo
  // tab can both report active while the user is in the sidebar.
  it("keeps a focused sidebar even while both editor panels report active", () => {
    expect(closeTaskTarget({ ...surfaces, focused: "sidebar" })).toBe("sidebar")
  })

  it("falls back to an active editor panel when no surface is known", () => {
    expect(closeTaskTarget({ ...surfaces, focused: undefined })).toBe("agentManager")
    expect(closeTaskTarget({ ...surfaces, agentManager: undefined, focused: undefined })).toBe("tab")
    expect(closeTaskTarget({ sidebar: "sidebar", focused: undefined })).toBe("sidebar")
  })

  it("ignores a remembered surface that is no longer available", () => {
    expect(closeTaskTarget({ sidebar: "sidebar", tab: "tab", focused: "agentManager" })).toBe("tab")
    expect(closeTaskTarget({ sidebar: "sidebar", focused: "tab" })).toBe("sidebar")
  })
})

describe("SurfaceFocus", () => {
  // The Command Palette blurs the webview before the command runs, so the
  // surface must survive losing focus or these commands would target the wrong
  // one and, on Agent Manager, abort sessions.
  it("remembers the surface after its webview loses focus", () => {
    const focus = new SurfaceFocus()

    focus.gained("sidebar")

    expect(focus.current()).toBe("sidebar")
  })

  it("follows the user to another surface", () => {
    const focus = new SurfaceFocus()

    focus.gained("sidebar")
    focus.gained("agentManager")

    expect(focus.current()).toBe("agentManager")
  })

  it("forgets a surface once it is hidden or closed", () => {
    const focus = new SurfaceFocus()

    focus.gained("agentManager")
    focus.lost("agentManager")

    expect(focus.current()).toBeUndefined()
  })

  it("keeps the current surface when a different one goes away", () => {
    const focus = new SurfaceFocus()

    focus.gained("sidebar")
    focus.lost("agentManager")

    expect(focus.current()).toBe("sidebar")
  })
})
