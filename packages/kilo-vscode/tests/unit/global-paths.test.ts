import { describe, it, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
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

  it("uses canonical paths for existing directories", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-path-canonical-"))
    const root = path.join(base, "repo")
    const link = path.join(base, "repo-link")

    await fs.mkdir(root, { recursive: true })
    const kind: "dir" | "junction" = process.platform === "win32" ? "junction" : "dir"
    await fs.symlink(root, link, kind)

    try {
      expect(agentManagerDir(root)).toBe(agentManagerDir(link))
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })
})
