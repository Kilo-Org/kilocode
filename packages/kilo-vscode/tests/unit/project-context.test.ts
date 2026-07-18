import { describe, expect, test } from "bun:test"
import {
  createProjectContext,
  type ProjectContextDeps,
} from "../../src/agent-manager/project-context"
import type { Project } from "../../src/agent-manager/project-registry"

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "f64e3a9b8c1d2705",
    root: "/Users/me/code/kilocode",
    order: 0,
    collapsed: false,
    trusted: false,
    ...overrides,
  }
}

describe("ProjectContext", () => {
  test("exposes the project's id and canonical root", () => {
    const ctx = createProjectContext(makeProject({ id: "abc123456789def0", root: "/Users/me/code/cloud" }), makeDeps())
    expect(ctx.id).toBe("abc123456789def0")
    expect(ctx.root).toBe("/Users/me/code/cloud")
    expect(ctx.trusted).toBe(false)
  })

  test("propagates the project's trusted flag onto the context", () => {
    const ctx = createProjectContext(makeProject({ trusted: true }), makeDeps())
    expect(ctx.trusted).toBe(true)
  })

  test("constructs lazily: does not call the worktree factory until getWorktreeManager is invoked", () => {
    const deps = makeDeps()
    let calls = 0
    deps.buildWorktreeManager = () => {
      calls += 1
      return { tag: calls }
    }
    const ctx = createProjectContext(makeProject(), deps)
    expect(calls).toBe(0)
    void ctx.getWorktreeManager()
    expect(calls).toBe(1)
  })

  test("returns the same manager on repeated getWorktreeManager calls (singleton-per-context)", () => {
    const deps = makeDeps()
    let calls = 0
    deps.buildWorktreeManager = () => {
      calls += 1
      return { tag: calls }
    }
    const ctx = createProjectContext(makeProject(), deps)
    const first = ctx.getWorktreeManager()
    const second = ctx.getWorktreeManager()
    expect(first).toBe(second)
    expect(calls).toBe(1)
  })

  test("getWorktreeManager returns undefined after dispose", () => {
    const deps = makeDeps()
    deps.buildWorktreeManager = () => ({ placeholder: true })
    const ctx = createProjectContext(makeProject(), deps)
    ctx.getWorktreeManager()
    ctx.dispose()
    expect(ctx.getWorktreeManager()).toBeUndefined()
    expect(ctx.id).toBe("f64e3a9b8c1d2705")
    expect(ctx.root).toBe("/Users/me/code/kilocode")
  })
})

function makeDeps(): ProjectContextDeps {
  return {
    buildWorktreeManager: () => ({ kind: "fake-worktree-manager" }),
  }
}
