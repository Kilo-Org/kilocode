import { describe, expect, it } from "bun:test"
import { resolveContextDirectory, resolveWorkspaceDirectory } from "../../src/kilo-provider-utils"

describe("resolveWorkspaceDirectory", () => {
  it("uses an explicit session worktree override", () => {
    const dir = resolveWorkspaceDirectory({
      sessionID: "ses_worktree",
      sessionDirectories: new Map([["ses_worktree", "/repo/.kilo/worktrees/feature"]]),
      workspaceDirectory: "/repo",
    })

    expect(dir).toBe("/repo/.kilo/worktrees/feature")
  })

  it("falls back to the workspace root without a session id", () => {
    const dir = resolveWorkspaceDirectory({
      sessionDirectories: new Map([["ses_worktree", "/repo/.kilo/worktrees/feature"]]),
      workspaceDirectory: "/repo",
    })

    expect(dir).toBe("/repo")
  })
})

describe("resolveContextDirectory", () => {
  it("uses the active session worktree when a worktree session is selected", () => {
    const dir = resolveContextDirectory({
      currentSessionID: "ses_worktree",
      sessionDirectories: new Map([["ses_worktree", "/repo/.kilo/worktrees/feature"]]),
      workspaceDirectory: "/repo",
    })

    expect(dir).toBe("/repo/.kilo/worktrees/feature")
  })

  it("keeps the last worktree after clearSession removes the active session", () => {
    const dir = resolveContextDirectory({
      contextSessionID: "ses_worktree",
      sessionDirectories: new Map([["ses_worktree", "/repo/.kilo/worktrees/feature"]]),
      workspaceDirectory: "/repo",
    })

    expect(dir).toBe("/repo/.kilo/worktrees/feature")
  })

  it("falls back to the workspace root when no worktree override exists", () => {
    const dir = resolveContextDirectory({
      contextSessionID: "ses_local",
      sessionDirectories: new Map(),
      workspaceDirectory: "/repo",
    })

    expect(dir).toBe("/repo")
  })
})
