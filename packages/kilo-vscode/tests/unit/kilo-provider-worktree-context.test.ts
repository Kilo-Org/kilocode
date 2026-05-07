import { describe, expect, it } from "bun:test"
import {
  resolveContextDirectory,
  resolveNewSessionDirectory,
  resolveWorkspaceDirectory,
} from "../../src/kilo-provider-utils"

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

  it("can force local context even when the last session was in a worktree", () => {
    const dir = resolveContextDirectory({
      contextSessionID: "ses_worktree",
      sessionDirectories: new Map([["ses_worktree", "/repo/.kilo/worktrees/feature"]]),
      workspaceDirectory: "/repo",
      forceWorkspaceRoot: true,
    })

    expect(dir).toBe("/repo")
  })
})

describe("resolveNewSessionDirectory", () => {
  it("keeps existing worktree sessions in their registered directory", () => {
    const dir = resolveNewSessionDirectory({
      sessionID: "ses_worktree",
      contextSessionID: "ses_local",
      agentManagerContext: "local",
      sessionDirectories: new Map([["ses_worktree", "/repo/.kilo/worktrees/feature"]]),
      workspaceDirectory: "/repo",
    })

    expect(dir).toBe("/repo/.kilo/worktrees/feature")
  })

  it("creates follow-up worktree sessions in the last worktree after clearSession", () => {
    const dir = resolveNewSessionDirectory({
      contextSessionID: "ses_worktree",
      agentManagerContext: "wt_feature",
      sessionDirectories: new Map([["ses_worktree", "/repo/.kilo/worktrees/feature"]]),
      workspaceDirectory: "/repo",
    })

    expect(dir).toBe("/repo/.kilo/worktrees/feature")
  })

  it("creates local Agent Manager sessions in the workspace root after a worktree was selected", () => {
    const dir = resolveNewSessionDirectory({
      contextSessionID: "ses_worktree",
      agentManagerContext: "local",
      sessionDirectories: new Map([["ses_worktree", "/repo/.kilo/worktrees/feature"]]),
      workspaceDirectory: "/repo",
    })

    expect(dir).toBe("/repo")
  })
})
