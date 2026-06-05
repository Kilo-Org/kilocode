import { describe, expect, it } from "bun:test"
import { resolvePanelProjectDirectory, resolveProjectDirectory } from "../../src/project-directory"

describe("project directory resolution", () => {
  const folders = [{ uri: { fsPath: "/repo-a" } }, { uri: { fsPath: "/repo-b" } }]

  it("prefers the active editor project", () => {
    expect(resolvePanelProjectDirectory("/repo-b", folders)).toBe("/repo-b")
  })

  it("uses the only open workspace", () => {
    expect(resolvePanelProjectDirectory(undefined, [folders[0]])).toBe("/repo-a")
  })

  it("disables project scope when a multi-root workspace is ambiguous", () => {
    expect(resolvePanelProjectDirectory(undefined, folders)).toBeNull()
  })

  it("preserves an explicit null project override", () => {
    expect(resolveProjectDirectory(null, () => "/repo-a")).toBeUndefined()
  })
})
