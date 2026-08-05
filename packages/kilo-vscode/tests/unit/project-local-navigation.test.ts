import { describe, expect, it } from "bun:test"
import { worktreeNavId } from "../../webview-ui/agent-manager/navigate"
import { projectAdjacentHint, projectWorktreeRow } from "../../webview-ui/agent-manager/project-local-navigation"

describe("projectAdjacentHint", () => {
  it("does not leak a hint to another project with the same raw ID", () => {
    expect(projectAdjacentHint("project-a", "project-a", "shared", "local", ["local", "shared"], "prev", "next")).toBe(
      "next",
    )
    expect(projectAdjacentHint("project-b", "project-a", "shared", "local", ["local", "shared"], "prev", "next")).toBe(
      "",
    )
  })

  it("uses the active project's local sidebar order", () => {
    expect(projectAdjacentHint("project-a", "project-a", "shared", "local", ["local", "shared"], "prev", "next")).toBe(
      "next",
    )
    expect(projectAdjacentHint("project-a", "project-a", "local", "shared", ["local", "shared"], "prev", "next")).toBe(
      "prev",
    )
    expect(
      projectAdjacentHint("project-b", "project-b", "shared", "local", ["local", "other", "shared"], "prev", "next"),
    ).toBe("")
  })

  it("keeps shortcut and worktree keybinding values scoped for duplicate raw IDs", () => {
    const bindings = {
      previousSession: "Ctrl+Alt+Up",
      nextSession: "Ctrl+Alt+Down",
      closeWorktree: "Ctrl+Shift+W",
      openWorktree: "Ctrl+Shift+O",
    }
    const shortcuts = new Map([
      [worktreeNavId("project-a", "shared"), 2],
      [worktreeNavId("project-b", "shared"), 4],
    ])
    const first = projectWorktreeRow({
      projectId: "project-a",
      activeProjectId: "project-a",
      worktreeId: "shared",
      activeId: "local",
      flatIds: ["local", "shared"],
      bindings,
      shortcuts,
    })
    const second = projectWorktreeRow({
      projectId: "project-b",
      activeProjectId: "project-a",
      worktreeId: "shared",
      activeId: "local",
      flatIds: ["local", "shared"],
      bindings,
      shortcuts,
    })

    expect(first.navHint).toBe(bindings.nextSession)
    expect(second.navHint).toBe("")
    expect(first.shortcut).toBe(2)
    expect(second.shortcut).toBe(4)
    expect(first.closeKeybind).toBe(bindings.closeWorktree)
    expect(first.openKeybind).toBe(bindings.openWorktree)
    expect(second.closeKeybind).toBe(bindings.closeWorktree)
    expect(second.openKeybind).toBe(bindings.openWorktree)
  })
})
