import { describe, expect, it } from "bun:test"
import { projectAdjacentHint } from "../../webview-ui/agent-manager/project-local-navigation"

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
})
