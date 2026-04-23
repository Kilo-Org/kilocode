import { describe, expect, it } from "bun:test"
import { createProject } from "../../../src/legacy-migration/sessions/lib/project"

describe("legacy migration project", () => {
  it("builds a project from the legacy workspace and timestamp", () => {
    const project = createProject({
      id: "legacy-task-1",
      ts: 1774861014564,
      workspace: "/workspace/testing",
      task: "Understand this project",
      mode: "code",
    })

    expect(project.worktree).toBe("/workspace/testing")
    expect(project.sandboxes).toEqual(["/workspace/testing"])
    expect(project.timeCreated).toBe(1774861014564)
    expect(project.timeUpdated).toBe(1774861014564)
  })

  it("creates a deterministic project id for the same workspace", () => {
    const a = createProject({ id: "legacy-1", workspace: "/workspace/testing" })
    const b = createProject({ id: "legacy-1", workspace: "/workspace/testing" })

    expect(a.id).toBe(b.id)
  })

  it("falls back to empty defaults when legacy workspace data is missing", () => {
    const project = createProject()

    expect(project.worktree).toBe("")
    expect(project.sandboxes).toEqual([])
    expect(project.timeCreated).toBe(0)
    expect(project.timeUpdated).toBe(0)
  })
})
