import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import * as path from "path"
import { WorkspaceIgnoreController } from "../../src/services/autocomplete/shims/WorkspaceIgnoreController"
import { findRepository } from "../../src/services/commit-message"
import { createTerminalHost } from "../../src/agent-manager/terminal-host"

const workspace = vscode.workspace as unknown as { workspaceFolders?: unknown }
const folders = workspace.workspaceFolders

let root = ""
let alpha = ""
let beta = ""

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kilo-mr-left-"))
  alpha = path.join(root, "alpha")
  beta = path.join(root, "beta")
  mkdirSync(alpha)
  mkdirSync(beta)
  writeFileSync(path.join(beta, ".kilocodeignore"), "secret.ts\n")
})

afterEach(() => {
  workspace.workspaceFolders = folders
  rmSync(root, { recursive: true, force: true })
})

describe("WorkspaceIgnoreController", () => {
  it("checks each file against its own folder's ignore rules", async () => {
    const ignore = new WorkspaceIgnoreController(() => [alpha, beta])
    await ignore.initialize()

    expect(ignore.validateAccess(path.join(alpha, "a.ts"))).toBe(true)
    expect(ignore.validateAccess(path.join(beta, "b.ts"))).toBe(true)
    expect(ignore.validateAccess(path.join(beta, "secret.ts"))).toBe(false)
    expect(ignore.validateAccess(path.join(root, "outside.ts"))).toBe(false)
  })

  it("accepts file URIs and paths relative to the first folder", async () => {
    const ignore = new WorkspaceIgnoreController(() => [alpha, beta])
    await ignore.initialize()

    const uri = (file: string) => {
      const slashed = file.replaceAll("\\", "/")
      return `file://${slashed.startsWith("/") ? "" : "/"}${slashed}`
    }

    expect(ignore.validateAccess(uri(path.join(beta, "b.ts")))).toBe(true)
    expect(ignore.validateAccess(uri(path.join(beta, "secret.ts")))).toBe(false)
    expect(ignore.validateAccess("src/a.ts")).toBe(true)
  })

  it("loads a folder added later and denies it until its rules are read", async () => {
    const roots = [alpha]
    const ignore = new WorkspaceIgnoreController(() => roots)
    await ignore.initialize()
    roots.push(beta)

    expect(ignore.validateAccess(path.join(beta, "b.ts"))).toBe(false)
    for (let tries = 0; tries < 100 && !ignore.validateAccess(path.join(beta, "b.ts")); tries++) await Bun.sleep(5)

    expect(ignore.validateAccess(path.join(beta, "b.ts"))).toBe(true)
    expect(ignore.validateAccess(path.join(beta, "secret.ts"))).toBe(false)
  })
})

describe("commit message repository", () => {
  const repo = (fsPath: string) => ({ inputBox: { value: "" }, rootUri: { fsPath } as vscode.Uri })

  it("prefers the Source Control view's repository", () => {
    const repos = [repo(alpha), repo(beta)]
    expect(findRepository(repos, { rootUri: { fsPath: beta } } as never, alpha)).toBe(repos[1])
  })

  it("uses the repository of the picked root from the Command Palette", () => {
    const repos = [repo(alpha), repo(beta)]
    expect(findRepository(repos, undefined, beta)).toBe(repos[1])
    expect(findRepository(repos, undefined, path.join(beta, "pkg"))).toBe(repos[1])
  })

  it("falls back to the first repository", () => {
    const repos = [repo(alpha), repo(beta)]
    expect(findRepository(repos, undefined, path.join(root, "other"))).toBe(repos[0])
    expect(findRepository(repos)).toBe(repos[0])
  })
})

describe("Agent Manager terminal fallback", () => {
  it("opens in the Agent Manager project, then the first folder", () => {
    workspace.workspaceFolders = [{ uri: { fsPath: alpha } }, { uri: { fsPath: beta } }]

    expect(createTerminalHost(() => beta).repoPath()).toBe(beta)
    expect(createTerminalHost(() => undefined).repoPath()).toBe(alpha)
    expect(createTerminalHost().repoPath()).toBe(alpha)
  })
})
