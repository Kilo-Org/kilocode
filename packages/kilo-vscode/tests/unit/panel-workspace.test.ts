import { describe, expect, it } from "bun:test"
import { resolvePanelProjectDirectory } from "../../src/panel-workspace"

describe("resolvePanelProjectDirectory", () => {
  it("prefers the active workspace directory", () => {
    const result = resolvePanelProjectDirectory("/repo-b", [
      { uri: { fsPath: "/repo-a" } },
      { uri: { fsPath: "/repo-b" } },
    ])
    expect(result).toBe("/repo-b")
  })

  it("uses the single workspace folder when there is no active editor", () => {
    const result = resolvePanelProjectDirectory(undefined, [{ uri: { fsPath: "/repo" } }])
    expect(result).toBe("/repo")
  })

  it("disables project scope when the workspace is ambiguous", () => {
    const result = resolvePanelProjectDirectory(undefined, [
      { uri: { fsPath: "/repo-a" } },
      { uri: { fsPath: "/repo-b" } },
    ])
    expect(result).toBeNull()
  })
})
