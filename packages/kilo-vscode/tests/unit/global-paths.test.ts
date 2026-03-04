import { describe, it, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import {
  agentManagerDir,
  worktreeDir,
  stateFile,
  legacyStateFile,
  legacyWorktreeDir,
} from "../../src/agent-manager/globalPaths"

describe("agent-manager global paths", () => {
  it("builds a deterministic repo slug from root path", () => {
    const root = path.join(os.tmpdir(), "My Repo")
    const a = agentManagerDir(root)
    const b = agentManagerDir(path.resolve(root))

    expect(a).toBe(b)
    expect(path.basename(a)).toMatch(/^my-repo-[0-9a-f]{8}$/)
  })

  it("produces different directories for different roots", () => {
    const a = agentManagerDir(path.join(os.tmpdir(), "repo-a"))
    const b = agentManagerDir(path.join(os.tmpdir(), "repo-b"))

    expect(a).not.toBe(b)
  })

  it("builds worktree and state paths under the same base", () => {
    const root = path.join(os.tmpdir(), "repo-layout")
    const base = agentManagerDir(root)

    expect(worktreeDir(root)).toBe(path.join(base, "worktrees"))
    expect(stateFile(root)).toBe(path.join(base, "agent-manager.json"))
  })

  it("keeps legacy paths inside the repository", () => {
    const root = path.join(os.tmpdir(), "repo-legacy")

    expect(legacyStateFile(root)).toBe(path.join(root, ".kilocode", "agent-manager.json"))
    expect(legacyWorktreeDir(root)).toBe(path.join(root, ".kilocode", "worktrees"))
  })
})
