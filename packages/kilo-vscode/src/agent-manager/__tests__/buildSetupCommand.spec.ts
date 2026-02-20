import { describe, it, expect } from "vitest"
import { buildSetupCommand } from "../setup-script-command"

const env = {
  worktreePath: "/repos/project/.kilocode/worktrees/wt-1",
  repoPath: "/repos/project",
}

const script = "/repos/project/.kilocode/setup-script"

describe("buildSetupCommand", () => {
  it("builds unix command with inline env vars and sh", () => {
    const result = buildSetupCommand(script, env, "darwin")
    expect(result).toBe(
      `WORKTREE_PATH="/repos/project/.kilocode/worktrees/wt-1" REPO_PATH="/repos/project" sh "/repos/project/.kilocode/setup-script"`,
    )
  })

  it("builds linux command same as darwin", () => {
    const result = buildSetupCommand(script, env, "linux")
    expect(result).toContain("sh ")
    expect(result).not.toContain("set ")
    expect(result).not.toContain("call ")
  })

  it("builds windows command with set and call", () => {
    const result = buildSetupCommand(script, env, "win32")
    expect(result).toBe(
      `set "WORKTREE_PATH=/repos/project/.kilocode/worktrees/wt-1" && set "REPO_PATH=/repos/project" && call "/repos/project/.kilocode/setup-script"`,
    )
  })

  it("includes both env vars in unix command", () => {
    const result = buildSetupCommand(script, env, "darwin")
    expect(result).toContain(`WORKTREE_PATH="${env.worktreePath}"`)
    expect(result).toContain(`REPO_PATH="${env.repoPath}"`)
  })

  it("includes both env vars in windows command", () => {
    const result = buildSetupCommand(script, env, "win32")
    expect(result).toContain(`set "WORKTREE_PATH=${env.worktreePath}"`)
    expect(result).toContain(`set "REPO_PATH=${env.repoPath}"`)
  })

  it("handles paths with spaces", () => {
    const spaced = {
      worktreePath: "/Users/dev/my project/.kilocode/worktrees/wt-1",
      repoPath: "/Users/dev/my project",
    }
    const spacedScript = "/Users/dev/my project/.kilocode/setup-script"

    const unix = buildSetupCommand(spacedScript, spaced, "darwin")
    expect(unix).toContain(`sh "/Users/dev/my project/.kilocode/setup-script"`)

    const win = buildSetupCommand(spacedScript, spaced, "win32")
    expect(win).toContain(`call "/Users/dev/my project/.kilocode/setup-script"`)
  })

  it("escapes double quotes in unix paths", () => {
    const dangerous = {
      worktreePath: '/repos/proj"ect',
      repoPath: "/repos/safe",
    }
    const result = buildSetupCommand(script, dangerous, "darwin")
    expect(result).toContain(`WORKTREE_PATH="/repos/proj\\"ect"`)
  })

  it("escapes dollar signs in unix paths", () => {
    const dangerous = {
      worktreePath: "/repos/$HOME/project",
      repoPath: "/repos/safe",
    }
    const result = buildSetupCommand(script, dangerous, "darwin")
    expect(result).toContain(`WORKTREE_PATH="/repos/\\$HOME/project"`)
  })

  it("escapes backticks in unix paths", () => {
    const dangerous = {
      worktreePath: "/repos/`whoami`/project",
      repoPath: "/repos/safe",
    }
    const result = buildSetupCommand(script, dangerous, "darwin")
    expect(result).toContain('WORKTREE_PATH="/repos/\\`whoami\\`/project"')
  })
})
