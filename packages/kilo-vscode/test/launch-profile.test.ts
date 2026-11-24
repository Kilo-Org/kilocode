import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { launchProfile, mainCheckout } from "../script/launch-profile"

const dirs: string[] = []

function makeTemp() {
  const dir = mkdtempSync(path.join(tmpdir(), "kilo-launch-profile-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("mainCheckout", () => {
  test("returns the checkout root for a normal repository", () => {
    const repo = makeTemp()
    mkdirSync(path.join(repo, ".git"), { recursive: true })
    const root = path.join(repo, "packages", "kilo-vscode")
    mkdirSync(root, { recursive: true })

    expect(mainCheckout(root)).toBe(repo)
  })

  test("resolves a git worktree back to the main repository checkout", () => {
    const base = makeTemp()
    const repo = path.join(base, "repo")
    const wtGit = path.join(repo, ".git", "worktrees", "feature-a")
    const wt = path.join(repo, ".kilo", "worktrees", "feature-a")
    mkdirSync(path.join(repo, "packages", "kilo-vscode"), { recursive: true })
    mkdirSync(wtGit, { recursive: true })
    mkdirSync(path.join(wt, "packages", "kilo-vscode"), { recursive: true })
    writeFileSync(path.join(wtGit, "commondir"), "../..\n")
    writeFileSync(path.join(wt, ".git"), `gitdir: ${wtGit}\n`)

    expect(mainCheckout(path.join(wt, "packages", "kilo-vscode"))).toBe(repo)
  })

  test("falls back to the checkout when there is no .git entry", () => {
    const repo = makeTemp()
    const root = path.join(repo, "packages", "kilo-vscode")
    mkdirSync(root, { recursive: true })

    expect(mainCheckout(root)).toBe(repo)
  })
})

describe("launchProfile", () => {
  test("shares one profile under the main repo across worktrees by default", () => {
    const base = makeTemp()
    const repo = path.join(base, "repo")
    const wtGit = path.join(repo, ".git", "worktrees", "feature-a")
    const wt = path.join(repo, ".kilo", "worktrees", "feature-a")
    const mainRoot = path.join(repo, "packages", "kilo-vscode")
    const wtRoot = path.join(wt, "packages", "kilo-vscode")
    mkdirSync(mainRoot, { recursive: true })
    mkdirSync(wtGit, { recursive: true })
    mkdirSync(wtRoot, { recursive: true })
    writeFileSync(path.join(wtGit, "commondir"), "../..\n")
    writeFileSync(path.join(wt, ".git"), `gitdir: ${wtGit}\n`)

    const expected = path.join(repo, "packages", "kilo-vscode", ".kilo-dev", "profile")
    expect(launchProfile({ root: mainRoot, state: "/tmp/state-main", env: {}, fresh: false, isolated: false })).toBe(
      expected,
    )
    expect(launchProfile({ root: wtRoot, state: "/tmp/state-wt", env: {}, fresh: false, isolated: false })).toBe(
      expected,
    )
  })

  test("prefers explicit KILO_V2_PROFILE over defaults and flags", () => {
    expect(
      launchProfile({
        root: "/repo/packages/kilo-vscode",
        state: "/tmp/state",
        env: { KILO_V2_PROFILE: "/custom/profile" },
        fresh: true,
        isolated: true,
      }),
    ).toBe("/custom/profile")
  })

  test("uses the state directory profile for --fresh and --isolated", () => {
    expect(
      launchProfile({
        root: "/repo/packages/kilo-vscode",
        state: "/tmp/state-fresh",
        env: {},
        fresh: true,
        isolated: false,
      }),
    ).toBe(path.join("/tmp/state-fresh", "profile"))

    expect(
      launchProfile({
        root: "/repo/packages/kilo-vscode",
        state: "/tmp/state-iso",
        env: {},
        fresh: false,
        isolated: true,
      }),
    ).toBe(path.join("/tmp/state-iso", "profile"))
  })
})
