import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { listEnvFiles, copyEnvFiles } from "../../src/agent-manager/env-copy"

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "env-copy-test-"))
}

describe("listEnvFiles", () => {
  let dir: string

  beforeEach(() => {
    dir = tmpdir()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("returns empty array when no .env files exist", () => {
    expect(listEnvFiles(dir)).toEqual([])
  })

  it("finds .env at root", () => {
    fs.writeFileSync(path.join(dir, ".env"), "KEY=val")
    expect(listEnvFiles(dir)).toEqual([".env"])
  })

  it("finds multiple .env variants", () => {
    fs.writeFileSync(path.join(dir, ".env"), "A=1")
    fs.writeFileSync(path.join(dir, ".env.local"), "B=2")
    fs.writeFileSync(path.join(dir, ".env.development"), "C=3")
    const result = listEnvFiles(dir).sort()
    expect(result).toEqual([".env", ".env.development", ".env.local"])
  })

  it("ignores directories named .env", () => {
    fs.mkdirSync(path.join(dir, ".env"))
    fs.mkdirSync(path.join(dir, ".env.local"))
    expect(listEnvFiles(dir)).toEqual([])
  })

  it("ignores .envrc and other non-dotenv files", () => {
    fs.writeFileSync(path.join(dir, ".envrc"), "use nix")
    fs.writeFileSync(path.join(dir, ".environment"), "X=1")
    fs.writeFileSync(path.join(dir, ".env-cmdrc"), "{}")
    fs.writeFileSync(path.join(dir, "not-env"), "Y=2")
    fs.writeFileSync(path.join(dir, "env.bak"), "Z=3")
    expect(listEnvFiles(dir)).toEqual([])
  })

  it("returns empty array for nonexistent directory", () => {
    expect(listEnvFiles(path.join(dir, "nope"))).toEqual([])
  })
})

describe("copyEnvFiles", () => {
  let repo: string
  let worktree: string
  let logs: string[]

  beforeEach(() => {
    repo = tmpdir()
    worktree = tmpdir()
    logs = []
  })

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
    fs.rmSync(worktree, { recursive: true, force: true })
  })

  function log(msg: string) {
    logs.push(msg)
  }

  it("copies .env files from repo to worktree", async () => {
    fs.writeFileSync(path.join(repo, ".env"), "SECRET=abc")
    fs.writeFileSync(path.join(repo, ".env.local"), "LOCAL=xyz")

    const result = await copyEnvFiles(repo, worktree, log)

    expect(result.copied.sort()).toEqual([".env", ".env.local"])
    expect(result.skipped).toEqual([])
    expect(fs.readFileSync(path.join(worktree, ".env"), "utf-8")).toBe("SECRET=abc")
    expect(fs.readFileSync(path.join(worktree, ".env.local"), "utf-8")).toBe("LOCAL=xyz")
  })

  it("skips files that already exist in worktree", async () => {
    fs.writeFileSync(path.join(repo, ".env"), "NEW=val")
    fs.writeFileSync(path.join(worktree, ".env"), "EXISTING=val")

    const result = await copyEnvFiles(repo, worktree, log)

    expect(result.copied).toEqual([])
    expect(result.skipped).toEqual([".env"])
    expect(fs.readFileSync(path.join(worktree, ".env"), "utf-8")).toBe("EXISTING=val")
  })

  it("copies some and skips others", async () => {
    fs.writeFileSync(path.join(repo, ".env"), "A=1")
    fs.writeFileSync(path.join(repo, ".env.local"), "B=2")
    fs.writeFileSync(path.join(worktree, ".env"), "KEEP=me")

    const result = await copyEnvFiles(repo, worktree, log)

    expect(result.copied).toEqual([".env.local"])
    expect(result.skipped).toEqual([".env"])
    expect(fs.readFileSync(path.join(worktree, ".env"), "utf-8")).toBe("KEEP=me")
    expect(fs.readFileSync(path.join(worktree, ".env.local"), "utf-8")).toBe("B=2")
  })

  it("returns empty result when repo has no .env files", async () => {
    const result = await copyEnvFiles(repo, worktree, log)
    expect(result.copied).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it("logs copy actions", async () => {
    fs.writeFileSync(path.join(repo, ".env"), "X=1")
    fs.writeFileSync(path.join(repo, ".env.local"), "Y=2")
    fs.writeFileSync(path.join(worktree, ".env.local"), "Z=3")

    await copyEnvFiles(repo, worktree, log)

    expect(logs).toContain("Copied .env")
    expect(logs.some((l) => l.includes("Skipping .env.local"))).toBe(true)
  })
})
