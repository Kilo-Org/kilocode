import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { GitOps } from "../../src/agent-manager/GitOps"
import { check, fix, type FixDeps } from "../../src/agent-manager/worktree-readiness"
import { createProjectWiring } from "../../src/agent-manager/project/wiring"
import { handleProjectMessage } from "../../src/agent-manager/project/messages"
import { canonicalizePath, projectIdFor } from "../../src/agent-manager/project/paths"
import type { Host } from "../../src/agent-manager/host"
import type { AgentManagerOutMessage } from "../../src/agent-manager/types"

const dirs: string[] = []
let env: NodeJS.ProcessEnv
let home: string
let ops: GitOps

// Isolate from the developer's Git config: private HOME and XDG_CONFIG_HOME with their own
// .gitconfig (simple-git drops GIT_* variables, so HOME is what isolates the WorktreeManager path),
// GIT_CONFIG_GLOBAL/NOSYSTEM for direct git calls, and no inherited identity. The global config has
// no identity and forbids guessing one, so commits need the identity the fix saves. Nothing here
// runs in its own Bun process so outstanding work in other suites cannot see this HOME.
beforeEach(async () => {
  if (!process.env.KILO_READINESS_HOME || process.env.HOME !== process.env.KILO_READINESS_HOME)
    throw new Error("Run this fixture through tests/unit/worktree-readiness.test.ts with a private HOME")
  env = { ...process.env }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_") || key === "EMAIL") delete process.env[key]
  }
  home = canonicalizePath(process.env.HOME!)
  const config = path.join(home, ".gitconfig")
  await fs.writeFile(
    config,
    "[user]\n\tuseConfigOnly = true\n[init]\n\tdefaultBranch = trunk\n[commit]\n\tgpgsign = false\n",
  )
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = home
  process.env.GIT_CONFIG_GLOBAL = config
  process.env.GIT_CONFIG_NOSYSTEM = "1"
  process.env.LC_ALL = "C"
  process.env.GIT_TERMINAL_PROMPT = "0"
  ops = new GitOps({ log: () => {} })
})

afterEach(async () => {
  if (!env) return
  ops.dispose()
  for (const key of Object.keys(process.env)) {
    if (!(key in env)) delete process.env[key]
  }
  Object.assign(process.env, env)
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(path.join(home, ".git"), { recursive: true, force: true })
  await fs.rm(path.join(home, "child"), { recursive: true, force: true })
})

async function temp(prefix: string) {
  const dir = canonicalizePath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

function git(cwd: string, ...args: string[]) {
  // Bun.spawnSync doesn't pick up process.env changes on its own; pass the isolated env explicitly.
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString("utf8"))
  return Buffer.from(result.stdout).toString("utf8").trim()
}

async function repo(dir: string, commit: boolean) {
  await fs.mkdir(dir, { recursive: true })
  git(dir, "init", "-q")
  if (commit) git(dir, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-qm", "x")
  return dir
}

function fixDeps(ops: GitOps, overrides: Partial<FixDeps> = {}): FixDeps {
  let pick: string | undefined
  return {
    git: ops,
    trusted: () => true,
    exclude: async () => {},
    openRepository: () => {},
    branches: async () => {},
    attach: async () => "",
    pick: async () => undefined,
    picked: () => pick,
    remember: (root) => {
      pick = root
    },
    forget: () => {
      pick = undefined
    },
    ...overrides,
  }
}

/** The real project wiring over a fake Host that records what the fixes ask of VS Code. */
function wire(root: string, trusted: boolean | (() => boolean) = true) {
  const posts: AgentManagerOutMessage[] = []
  const calls = {
    refresh: 0,
    opened: [] as string[],
    picks: [] as Array<string | undefined>,
    pickResults: [] as Array<string | undefined>,
  }
  let stored: unknown
  const none = { dispose: () => {} }
  const host = {
    readProjects: () => stored,
    writeProjects: async (value: unknown) => {
      stored = value
    },
    workspacePath: () => root,
    unregisterProjectRoutes: () => {},
    worktreePool: () => false,
    onDidChangeWorkspaceFolders: () => none,
    onDidChangeWorktreePool: () => none,
    pickFolder: async (opts?: { defaultPath?: string }) => {
      calls.picks.push(opts?.defaultPath)
      return calls.pickResults.shift()
    },
    isTrusted: () => (typeof trusted === "function" ? trusted() : trusted),
    refreshGit: () => {
      calls.refresh++
    },
    openRepository: (root: string) => {
      calls.opened.push(root)
    },
    showError: () => {},
    notify: () => {},
    openSettings: () => {},
    openDocument: async () => {},
  } as unknown as Host
  const wiring = createProjectWiring({
    host,
    git: ops,
    log: () => {},
    output: () => {},
    activate: () => {},
    empty: () => {},
    expand: () => {},
    ready: async () => ({ ok: true, refsFixed: 0, current: true }),
    push: () => {},
    pushState: () => {},
    changed: () => {},
    selected: () => {},
    post: (message) => posts.push(message),
  })
  const id = projectIdFor(canonicalizePath(root))
  const send = (fix: "initGit" | "initialCommit" | "useProject" | "pickFolder", extra: Record<string, unknown> = {}) =>
    handleProjectMessage(
      { type: "agentManager.fixReadiness", projectId: id, requestID: "r1", fix, ...extra },
      wiring.messages,
    )
  const sendRaw = (fix: string, extra: Record<string, unknown> = {}) =>
    handleProjectMessage(
      { type: "agentManager.fixReadiness", projectId: id, requestID: "r1", fix, ...extra } as never,
      wiring.messages,
    )
  return { posts, calls, wiring, id, send, sendRaw }
}

const identity = { name: "Ada Lovelace", email: "ada@example.com" }

describe("worktree readiness check", () => {
  it("classifies each folder state from real repositories", async () => {
    const plain = await temp("kilo-ready-plain-")
    await fs.writeFile(path.join(plain, "notes.txt"), "draft")
    const parent = await temp("kilo-ready-parent-")
    for (const name of ["atlas", "beta", "comet", "delta"]) await repo(path.join(parent, name), true)
    await fs.mkdir(path.join(parent, "docs"))
    const empty = await repo(await temp("kilo-ready-empty-"), false)
    const healthy = await repo(await temp("kilo-ready-healthy-"), true)
    const broken = await temp("kilo-ready-broken-")
    await fs.mkdir(path.join(broken, ".git"))

    const deps = { git: ops, trusted: () => true }
    expect(await check(plain, deps)).toEqual({
      status: "blocked",
      code: "not_git_repo",
      name: path.basename(plain),
      trusted: true,
      identity: false,
    })
    expect(await check(parent, deps)).toEqual({
      status: "blocked",
      code: "not_git_repo",
      name: path.basename(parent),
      trusted: true,
      projects: ["atlas", "beta", "comet"].map((label) => ({ root: path.join(parent, label), label })),
      more: true,
    })
    const root = path.parse(plain).root
    expect(await check(root, deps)).toEqual({
      status: "blocked",
      code: "not_git_repo",
      name: path.basename(root),
      trusted: true,
      restricted: true,
    })
    expect(await check(empty, deps)).toEqual({
      status: "blocked",
      code: "no_commits",
      name: path.basename(empty),
      trusted: true,
      identity: false,
    })
    expect(await check(healthy, deps)).toEqual({ status: "ready" })
    const result = await check(broken, deps)
    expect(result.status).toBe("unknown")
    expect(result.status === "unknown" && result.detail).toContain(broken)
  })
})

describe("worktree readiness scan", () => {
  it("finds a child repo after more than 2000 files", async () => {
    const parent = await temp("kilo-ready-scan-files-")
    const deps = { git: ops, trusted: () => true }
    await Promise.all(
      Array.from({ length: 2_100 }, (_, index) =>
        fs.writeFile(path.join(parent, `f${String(index).padStart(4, "0")}`), ""),
      ),
    )
    await repo(path.join(parent, "zrepo"), true)

    const result = await check(parent, deps)

    expect(result).toMatchObject({ status: "blocked", code: "not_git_repo", projects: [{ label: "zrepo" }] })
    expect(result.status === "blocked" ? result.more : undefined).toBeUndefined()
  })

  it("reports more when the directory scan is truncated", async () => {
    const parent = await temp("kilo-ready-scan-dirs-")
    const deps = { git: ops, trusted: () => true }
    await Promise.all(
      Array.from({ length: 2_001 }, (_, index) =>
        fs.mkdir(path.join(parent, `d${String(index).padStart(4, "0")}`), { recursive: true }),
      ),
    )
    await repo(path.join(parent, "d0000"), true)

    const result = await check(parent, deps)

    expect(result).toMatchObject({ status: "blocked", code: "not_git_repo", more: true })
    expect(result.status === "blocked" ? result.projects?.map((project) => project.label) : []).toEqual(["d0000"])
  })
})

describe("worktree readiness flight", () => {
  it("coalesces concurrent checks for the same folder", async () => {
    const root = await repo(await temp("kilo-ready-flight-"), true)
    const deps = { git: ops, trusted: () => true }
    const first = check(root, deps)
    const second = check(root, deps)
    expect(second).toBe(first)
    await first
    const third = check(root, deps)
    expect(third).not.toBe(first)
    await third
  })
})

describe("worktree readiness fixes", () => {
  it("refuses a child of a repository rooted at HOME without changing its exclude", async () => {
    await repo(home, false)
    const child = path.join(home, "child")
    await fs.mkdir(child)
    const file = path.join(home, ".git", "info", "exclude")
    const before = await fs.readFile(file)
    const setup = wire(child)
    await setup.send("initialCommit", { identity })
    expect(Buffer.compare(await fs.readFile(file), before)).toBe(0)
    expect(await check(child, { git: ops, trusted: () => true })).toMatchObject({
      status: "blocked",
      code: "not_git_repo",
      restricted: true,
    })
    expect(setup.posts.at(-1)).toMatchObject({ error: expect.stringContaining("home folder") })
  })

  it.each(["identity", "attach"] as const)(
    "rechecks current trust before %s after an await boundary",
    async (mutation) => {
      const root = await repo(await temp("kilo-ready-trust-"), false)
      let trusted = true
      const attached: string[] = []
      const deps = fixDeps(ops, {
        trusted: () => trusted,
        exclude: async () => {
          trusted = false
        },
        attach: async (dir) => {
          attached.push(dir)
          return "picked"
        },
        pick: async () => {
          trusted = false
          return root
        },
      })
      const outcome = await fix(
        root,
        mutation === "identity" ? { fix: "initialCommit", identity } : { fix: "pickFolder" },
        deps,
      )
      expect(outcome.error).toContain("Trust")
      expect(git(root, "config", "--local", "--list")).not.toMatch(/user\.(name|email)=/)
      expect(attached).toEqual([])
    },
  )

  it("writes Kilo excludes immediately after init even when identity configuration fails", async () => {
    const root = await temp("kilo-ready-invalid-identity-")
    const setup = wire(root)
    await setup.send("initGit", { identity: { name: "bad\nname", email: identity.email } })
    expect(setup.posts.at(-1)).toMatchObject({ error: expect.stringContaining("Invalid Git name") })
    const exclude = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf8")
    expect(exclude).toContain("\n.kilo/worktrees/\n")
    expect(exclude).toContain("\n.kilo/agent-manager.json\n")
    expect(
      Bun.spawnSync(["git", "rev-parse", "--verify", "HEAD"], { cwd: root, env: { ...process.env } }).exitCode,
    ).not.toBe(0)
  })

  it("sets up Git in order: one empty commit, Kilo excludes, local identity, branches before the reply", async () => {
    const global = await fs.readFile(path.join(home, ".gitconfig"), "utf8")
    const scratch = await temp("kilo-ready-scratch-")
    await fs.writeFile(path.join(scratch, "notes.txt"), "draft")
    const setup = wire(scratch)

    expect(await setup.send("initGit", { identity })).toBe(true)

    expect(git(scratch, "rev-list", "--count", "HEAD")).toBe("1")
    expect(git(scratch, "ls-tree", "-r", "HEAD")).toBe("")
    expect(git(scratch, "status", "--porcelain")).toBe("?? notes.txt")
    const exclude = await fs.readFile(path.join(scratch, ".git", "info", "exclude"), "utf8")
    expect(exclude).toContain("\n.kilo/worktrees/\n")
    expect(exclude).toContain("\n.kilo/agent-manager.json\n")
    expect(git(scratch, "config", "--global", "user.name")).toBe(identity.name)
    expect(git(scratch, "config", "--global", "user.email")).toBe(identity.email)
    expect(git(scratch, "config", "--local", "--list")).not.toMatch(/user\.(name|email)=/)
    expect(await fs.readFile(path.join(home, ".gitconfig"), "utf8")).not.toBe(global)
    expect(setup.calls.opened).toEqual([scratch])
    expect(setup.calls.refresh).toBe(0)
    expect(setup.posts.map((post) => post.type)).toEqual(["agentManager.branches", "agentManager.readiness"])
    expect(setup.posts.at(0)).toMatchObject({ projectId: setup.id, defaultBranch: "trunk" })
    expect(setup.posts.at(0)).toMatchObject({ branches: [expect.objectContaining({ name: "trunk" })] })
    expect(setup.posts.at(1)).toEqual({
      type: "agentManager.readiness",
      projectId: setup.id,
      requestID: "r1",
      result: { status: "ready", note: "uncommitted" },
    })
  })

  it("saves the approved identity globally so a second repository needs no input", async () => {
    const first = await temp("kilo-ready-global-first-")
    const second = await temp("kilo-ready-global-second-")
    const one = wire(first)
    await one.send("initGit", { identity })

    expect(git(first, "config", "--global", "user.name")).toBe(identity.name)
    expect(git(first, "config", "--global", "user.email")).toBe(identity.email)
    expect(git(first, "config", "--local", "--list")).not.toMatch(/user\.(name|email)=/)

    const two = wire(second)
    await two.send("initGit")

    expect(two.posts.at(-1)).toMatchObject({ result: { status: "ready" } })
    expect(git(second, "rev-list", "--count", "HEAD")).toBe("1")
  })

  it("does not register a picked non-Git folder before setup", async () => {
    const current = await temp("kilo-ready-pick-current-")
    const picked = await temp("kilo-ready-pick-plain-")
    await fs.writeFile(path.join(picked, "notes.txt"), "draft")
    const setup = wire(current)
    setup.calls.pickResults.push(picked)

    await setup.send("pickFolder")

    expect(setup.posts.at(-1)).toMatchObject({
      result: { status: "blocked", code: "not_git_repo", name: path.basename(picked) },
    })
    expect(setup.wiring.registry.has(projectIdFor(canonicalizePath(picked)))).toBe(false)
  })

  it("sets up Git in the folder the user just picked and selects it", async () => {
    const original = await temp("kilo-ready-picked-original-")
    const picked = await temp("kilo-ready-picked-folder-")
    await fs.writeFile(path.join(picked, "notes.txt"), "draft")
    const setup = wire(original)
    setup.calls.pickResults.push(picked)

    await setup.send("pickFolder")
    expect(setup.posts.at(-1)).toMatchObject({
      result: { status: "blocked", code: "not_git_repo", name: path.basename(picked), picked: true },
    })

    await setup.send("initGit", { target: "picked", identity })

    expect(git(picked, "rev-list", "--count", "HEAD")).toBe("1")
    expect(await Bun.file(path.join(picked, ".git", "info", "exclude")).text()).toContain(".kilo/worktrees/")
    expect(await Bun.file(path.join(original, ".git")).exists()).toBe(false)
    expect(setup.posts.at(-1)).toMatchObject({
      selected: projectIdFor(canonicalizePath(picked)),
      result: { status: "ready" },
    })
    expect(setup.wiring.registry.has(projectIdFor(canonicalizePath(picked)))).toBe(true)

    await setup.send("initGit", { target: "picked", identity })
    expect(setup.posts.at(-1)).toMatchObject({ error: expect.stringContaining("no longer the one you picked") })
    expect(git(picked, "rev-list", "--count", "HEAD")).toBe("1")
  })

  it("selects a Git repo inside the folder the user just picked", async () => {
    const original = await temp("kilo-ready-picked-child-original-")
    const folder = await temp("kilo-ready-picked-child-folder-")
    const child = await repo(path.join(folder, "child"), true)
    const setup = wire(original)
    setup.calls.pickResults.push(folder)

    await setup.send("pickFolder")
    await setup.send("useProject", { target: child })

    expect(setup.posts.at(-1)).toMatchObject({
      selected: projectIdFor(canonicalizePath(child)),
      result: { status: "ready" },
    })
    expect(setup.wiring.registry.has(projectIdFor(canonicalizePath(child)))).toBe(true)
  })

  it("keeps the pick when a fix is attempted while the window is untrusted", async () => {
    let checks = 0
    let failAt = 0
    const original = await temp("kilo-ready-keep-pick-original-")
    const picked = await temp("kilo-ready-keep-pick-folder-")
    const setup = wire(original, () => ++checks !== failAt)
    setup.calls.pickResults.push(picked)

    // pickFolder: apply's trust check, choose's, then the folder probe's.
    await setup.send("pickFolder")
    // initGit: apply's check passes, usePick's check fails.
    failAt = 5
    await setup.send("initGit", { target: "picked", identity })

    expect(setup.posts.at(-1)).toMatchObject({ error: expect.stringContaining("Trust") })
    expect(await Bun.file(path.join(picked, ".git")).exists()).toBe(false)

    failAt = 0
    await setup.send("initGit", { target: "picked", identity })

    expect(git(picked, "rev-list", "--count", "HEAD")).toBe("1")
    expect(setup.posts.at(-1)).toMatchObject({ result: { status: "ready" } })
  })

  it("does not open the picker in an untrusted window", async () => {
    const setup = wire(await temp("kilo-ready-untrusted-pick-"), false)

    await setup.send("pickFolder")

    expect(setup.posts.at(-1)).toMatchObject({ error: expect.stringContaining("Trust") })
    expect(setup.calls.picks).toEqual([])
  })

  it("rejects a picked folder that became nested inside a repository", async () => {
    const original = await temp("kilo-ready-nested-original-")
    const holder = await temp("kilo-ready-nested-holder-")
    const picked = path.join(holder, "picked")
    await fs.mkdir(picked)
    const setup = wire(original)
    setup.calls.pickResults.push(picked)

    await setup.send("pickFolder")
    await repo(holder, true)
    const head = git(holder, "rev-parse", "HEAD")
    await setup.send("initGit", { target: "picked", identity })

    expect(setup.posts.at(-1)).toMatchObject({ error: expect.stringContaining("inside another Git repository") })
    expect(await Bun.file(path.join(picked, ".git")).exists()).toBe(false)
    expect(git(holder, "rev-parse", "HEAD")).toBe(head)
  })

  it("rejects a picked fix whose target is not the remembered folder", async () => {
    const original = await temp("kilo-ready-forged-original-")
    const picked = await temp("kilo-ready-forged-picked-")
    const forged = await temp("kilo-ready-forged-other-")
    const setup = wire(original)
    setup.calls.pickResults.push(picked)

    await setup.send("pickFolder")
    await setup.send("initGit", { target: forged, identity })

    expect(setup.posts.at(-1)).toMatchObject({ error: expect.stringContaining("no longer the one you picked") })
    expect(await Bun.file(path.join(forged, ".git")).exists()).toBe(false)
    expect(await Bun.file(path.join(picked, ".git")).exists()).toBe(false)
    expect(await Bun.file(path.join(original, ".git")).exists()).toBe(false)
    expect(setup.wiring.registry.has(projectIdFor(canonicalizePath(forged)))).toBe(false)
  })

  it("rejects a picked fix when nothing was picked", async () => {
    const root = await temp("kilo-ready-no-pick-")
    const setup = wire(root)

    await setup.send("initGit", { target: "picked", identity })

    expect(setup.posts.at(-1)).toMatchObject({ error: expect.stringContaining("no longer the one you picked") })
    expect(await Bun.file(path.join(root, ".git")).exists()).toBe(false)
  })

  it("rejects an unknown fix without initializing or committing", async () => {
    const root = await temp("kilo-ready-unknown-fix-")
    const setup = wire(root)

    await setup.sendRaw("bogus", { identity })
    expect(setup.posts.at(-1)).toMatchObject({ error: expect.stringContaining("Unknown readiness fix") })

    // An inherited key must be rejected at the boundary, before the trusted-window check runs.
    const untrusted = wire(root, false)
    await untrusted.sendRaw("constructor", { identity })

    expect(untrusted.posts.at(-1)).toMatchObject({
      error: expect.stringContaining("Unknown readiness fix: constructor"),
    })
    expect(await Bun.file(path.join(root, ".git", "HEAD")).exists()).toBe(false)
  })

  it("does not run a repository's fsmonitor program while finding uncommitted files", async () => {
    const root = await repo(await temp("kilo-ready-fsmonitor-"), false)
    await fs.writeFile(path.join(root, "staged.txt"), "staged")
    await fs.writeFile(path.join(root, "loose.txt"), "loose")
    git(root, "add", "staged.txt")
    const scripts = await temp("kilo-ready-fsmonitor-bin-")
    const marker = path.join(scripts, "marker")
    const hook = path.join(scripts, "hook.sh")
    await fs.writeFile(hook, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 0\n`)
    await fs.chmod(hook, 0o755)
    git(root, "config", "core.fsmonitor", hook)

    const setup = wire(root)
    await setup.send("initialCommit", { identity })

    expect(git(root, "rev-list", "--count", "HEAD")).toBe("1")
    expect(git(root, "ls-tree", "-r", "HEAD")).toBe("")
    expect(git(root, "-c", "core.fsmonitor=false", "status", "--porcelain").split("\n")).toEqual([
      "A  staged.txt",
      "?? loose.txt",
    ])
    expect(await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf8")).toContain("\n.kilo/worktrees/\n")
    expect(await Bun.file(marker).exists()).toBe(false)
    expect(setup.posts.at(1)).toMatchObject({ result: { status: "ready", note: "uncommitted" } })
  })

  it("refuses to change an untrusted window", async () => {
    const scratch = await temp("kilo-ready-untrusted-")
    const untrusted = wire(scratch, false)
    await untrusted.send("initGit", { identity })
    expect(await Bun.file(path.join(scratch, ".git", "HEAD")).exists()).toBe(false)
    expect(untrusted.posts).toEqual([
      {
        type: "agentManager.readiness",
        projectId: untrusted.id,
        requestID: "r1",
        result: {
          status: "blocked",
          code: "not_git_repo",
          name: path.basename(scratch),
          trusted: false,
          identity: false,
        },
        error: expect.stringContaining("Trust"),
      },
    ])
  })

  it("switches to a project inside the folder and refuses one outside it", async () => {
    const parent = await temp("kilo-ready-switch-")
    const inner = await repo(path.join(parent, "orbit"), true)
    const outside = await repo(await temp("kilo-ready-outside-"), true)
    const setup = wire(parent)

    await setup.send("useProject", { target: outside })
    await setup.send("useProject", { target: inner })

    expect(setup.posts.at(0)).toMatchObject({ projectId: setup.id, error: expect.any(String) })
    expect(setup.posts.at(0)).not.toHaveProperty("selected")
    expect(setup.posts.at(1)).toEqual({
      type: "agentManager.readiness",
      projectId: setup.id,
      requestID: "r1",
      selected: projectIdFor(inner),
      result: { status: "ready" },
    })
    expect(setup.wiring.registry.has(projectIdFor(inner))).toBe(true)
  })
})
