import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const script = path.resolve(import.meta.dir, "../script/branding-audit.ts")

function command(cwd: string, executable: string, args: string[]) {
  return spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  })
}

function git(cwd: string, args: string[]) {
  const result = command(cwd, "git", args)
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message)
  return result.stdout.trim()
}

function put(root: string, file: string, content: string) {
  const target = path.join(root, file)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function commit(root: string, message: string) {
  git(root, ["add", "-A"])
  git(root, ["-c", "user.name=Audit Test", "-c", "user.email=audit@example.invalid", "commit", "-qm", message])
  return git(root, ["rev-parse", "HEAD"])
}

test("audits committed trees and explicit working trees without following symlinks or emitting controls", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "branding-audit-"))
  const root = path.join(temp, "repo")
  const outside = path.join(temp, "outside")
  mkdirSync(root)
  mkdirSync(outside)
  try {
    git(root, ["init", "-q"])
    put(root, "packages/core/src/existing.ts", 'const old = "OpenCode existing"\n')
    put(root, "packages/core/src/dir/probe.ts", 'const old = "ordinary"\n')
    const base = commit(root, "base")
    put(root, "packages/core/src/existing.ts", 'const old = "OpenCode existing"\nconst count = 1\n')
    put(root, "packages/tui/src/view.tsx", 'const view = <text>OpenCode</text>\nconst other = "OpenCode remaining"\n')
    put(root, "packages/core/src/mixed.tsx", "const view = <text>OpenCode reads opencode.jsonc</text>\n")
    put(root, "packages/core/src/domain.tsx", "const view = <text>opencode.ai</text>\n")
    put(root, "packages/core/src/escaped.ts", "console.log(`\\u004fpenCode`)\n")
    put(
      root,
      "packages/tui/src/providers.tsx",
      'import value from "@opencode/core"\nconst view = <text>OpenCode Go</text>\nconst url = "https://opencode.ai"\n',
    )
    put(root, "packages/core/src/asset.txt", "OpenCode asset\n")
    put(root, "packages/core/src/control\u001b.ts", 'const message = "OpenCode\\u001b[31mALERT\\u009b31m"\n')
    put(outside, "probe.ts", 'const value = "OpenCode outside"\n')
    put(outside, "file.ts", 'const value = "OpenCode outside"\n')
    symlinkSync(path.join(outside, "file.ts"), path.join(root, "packages/core/src/symlink.ts"))
    const head = commit(root, "head")

    const audit = (args: string[]) => command(root, process.execPath, [script, ...args])
    const clean = audit([head])
    expect(clean.status).toBe(0)
    expect(clean.stdout).toContain("Branding audit passed")

    const committed = audit([base])
    expect(committed.status).toBe(1)
    expect(committed.stdout).toContain('"packages/tui/src/view.tsx":2: "OpenCode remaining"')
    expect(committed.stdout).not.toContain('"packages/tui/src/view.tsx":1:')
    expect(committed.stdout).toContain('"packages/core/src/mixed.tsx":1: "OpenCode reads opencode.jsonc"')
    expect(committed.stdout).toContain('"packages/core/src/domain.tsx":1: "opencode.ai"')
    expect(committed.stdout).toContain('"packages/core/src/escaped.ts":1: "OpenCode"')
    expect(committed.stdout).toContain('"packages/core/src/asset.txt":1: "OpenCode asset"')
    expect(committed.stdout).not.toContain("OpenCode existing")
    expect(committed.stdout).not.toContain("OpenCode outside")
    expect(committed.stdout).not.toContain("packages/tui/src/providers.tsx")
    expect(committed.stdout).not.toContain("packages/core/src/symlink.ts")
    expect(committed.stdout).toContain('"packages/core/src/control\\u001b.ts":1: "OpenCode\\u001b[31mALERT\\u009b31m"')
    expect(committed.stdout + committed.stderr).not.toContain("\u001b")
    expect(committed.stdout + committed.stderr).not.toContain("\u009b")

    put(root, "packages/core/src/existing.ts", 'const old = "OpenCode existing"\nconst dirty = "OpenCode dirty"\n')
    put(root, "packages/core/src/untracked.txt", "OpenCode untracked\n")
    symlinkSync(path.join(outside, "file.ts"), path.join(root, "packages/core/src/untracked-link.ts"))
    rmSync(path.join(root, "packages/core/src/dir"), { recursive: true })
    symlinkSync(outside, path.join(root, "packages/core/src/dir"), "dir")

    const repeated = audit([base])
    expect(repeated.status).toBe(committed.status)
    expect(repeated.stdout).toBe(committed.stdout)
    expect(repeated.stderr).toBe(committed.stderr)
    const working = audit([base, "--working-tree"])
    expect(working.status).toBe(1)
    expect(working.stdout).toContain("OpenCode dirty")
    expect(working.stdout).toContain("OpenCode untracked")
    expect(working.stdout).not.toContain("OpenCode outside")
    expect(working.stdout).not.toContain("packages/core/src/untracked-link.ts")
    expect(working.stdout + working.stderr).not.toContain("\u001b")
    expect(working.stdout + working.stderr).not.toContain("\u009b")
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}, 30_000)
