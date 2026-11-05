import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { WorktreeManager } from "../../src/agent-manager/WorktreeManager"
import { clearShellEnvCache } from "../../src/agent-manager/shell-env"

const dirs: string[] = []
let state = ""
let log = ""
const initial = { PATH: process.env.PATH, SHELL: process.env.SHELL }

beforeEach(async () => {
  process.env.PATH = initial.PATH
  process.env.SHELL = initial.SHELL
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-tools-"))
  dirs.push(dir)
  state = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-tools-state-"))
  dirs.push(state)
  log = path.join(state, "calls.log")
  await fs.writeFile(log, "")
  clearShellEnvCache()
  process.env.KILO_TOOLS_LOG = log
})

afterEach(async () => {
  clearShellEnvCache()
  process.env.PATH = initial.PATH
  process.env.SHELL = initial.SHELL
  delete process.env.KILO_TOOLS_LOG
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function temp(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function script(dir: string, name: string, body: string) {
  const file = path.join(dir, name)
  await fs.writeFile(file, `#!/bin/sh\n${body}\n`)
  await fs.chmod(file, 0o755)
  return file
}

async function calls() {
  return (await fs.readFile(log, "utf8")).split("\n").filter(Boolean)
}

function manager(root: string, binary: string, platform: NodeJS.Platform = "linux") {
  return new WorktreeManager(root, () => {}, undefined, binary, 1, undefined, { platform })
}

async function repo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-tools-repo-"))
  dirs.push(root)
  const git = process.env.KILO_REAL_GIT
  if (!git) throw new Error("KILO_REAL_GIT is required")
  const run = (args: string[]) => {
    const result = Bun.spawnSync([git, ...args], { cwd: root, stdout: "pipe", stderr: "pipe" })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString("utf8"))
  }
  run(["init", "-q"])
  run(["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-qm", "x"])
  return root
}

describe("Git probe", () => {
  it("guards the modal branch request before any Git execution on an Apple shim", async () => {
    const root = await repo()
    const bin = await temp("kilo-tools-bin-")
    const shim = path.join(bin, "git")
    await fs.symlink("/usr/bin/git", shim)
    await script(
      bin,
      "xcode-select",
      `echo "xcode-select $@" >> "$KILO_TOOLS_LOG"\necho "no developer tools" >&2\nexit 2`,
    )
    const previous = process.env.PATH
    process.env.PATH = [bin, previous].join(path.delimiter)
    try {
      const mgr = manager(root, shim, "darwin")
      await expect(mgr.listBranches()).rejects.toThrow(/Git is not installed/)
      expect(await calls()).toEqual(["xcode-select -p"])
      expect(mgr.gitProbeFailed).toBe(true)
      const probe = await mgr.probeGit()
      expect(probe.ok).toBe(false)
      expect(probe.ok ? "" : probe.detail).toContain("no developer tools")
    } finally {
      process.env.PATH = previous
    }
  })

  it("never guards a Homebrew or custom Git", async () => {
    const root = await repo()
    const bin = await temp("kilo-tools-bin-")
    await script(bin, "xcode-select", `echo "xcode-select $@" >> "$KILO_TOOLS_LOG"\nexit 2`)
    const custom = await script(bin, "custom-git", `echo "git $@" >> "$KILO_TOOLS_LOG"\nexec "$KILO_REAL_GIT" "$@"`)
    const previous = process.env.PATH
    process.env.PATH = [bin, previous].join(path.delimiter)
    try {
      const mgr = manager(root, custom, "darwin")
      const branches = await mgr.listBranches()
      expect(branches.defaultBranch).toBeTruthy()
      expect(await calls()).not.toContain("xcode-select -p")
      expect((await calls()).some((line) => line.startsWith("git "))).toBe(true)
    } finally {
      process.env.PATH = previous
    }
  }, 60_000)

  it("recomputes probeFailed instead of keeping a sticky missing verdict", async () => {
    const root = await temp("kilo-tools-root-")
    const bin = path.join(await temp("kilo-tools-bin-"), "git")

    const missing = manager(root, bin, "linux")
    expect(await missing.probeGit()).toMatchObject({ ok: false, code: "missing" })
    expect(missing.gitProbeFailed).toBe(true)

    await fs.writeFile(bin, "#!/bin/sh\nexit 0\n")
    await fs.chmod(bin, 0o644)
    const denied = await missing.probeGit()
    expect(denied.ok).toBe(false)
    expect(denied.ok ? "" : denied.code).toBe("unknown")
    expect(missing.gitProbeFailed).toBe(false)

    await fs.chmod(bin, 0o755)
    expect(await missing.probeGit()).toEqual({ ok: true })
    expect(missing.gitProbeFailed).toBe(false)
  })

  it("preserves raw Git and Git LFS errors and only blocks confirmed absence", async () => {
    const root = await temp("kilo-tools-root-")
    const bin = await temp("kilo-tools-bin-")

    const xcrun = await script(
      bin,
      "git-xcrun",
      `echo "xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools)" >&2\nexit 1`,
    )
    const missing = await manager(root, xcrun, "linux").probeGit()
    expect(missing.ok).toBe(false)
    expect(missing.ok ? "" : missing.code).toBe("missing")
    expect(missing.ok ? "" : missing.detail).toContain("invalid active developer path")

    const remote = await script(
      bin,
      "git-remote",
      `if [ "$1" = "lfs" ]; then echo "fatal: could not read from remote repository" >&2; exit 128; fi\nexit 0`,
    )
    const unknown = await manager(root, remote, "linux").probeLfs()
    expect(unknown.ok).toBe(false)
    expect(unknown.ok ? "" : unknown.code).toBe("unknown")
    expect(unknown.ok ? "" : unknown.detail).toContain("could not read from remote repository")

    const noLfs = await script(
      bin,
      "git-no-lfs",
      `if [ "$1" = "lfs" ]; then echo "git: 'lfs' is not a git command. See 'git --help'." >&2; exit 1; fi\nexit 0`,
    )
    const absent = await manager(root, noLfs, "linux").probeLfs()
    expect(absent.ok).toBe(false)
    expect(absent.ok ? "" : absent.code).toBe("missing")
  })
  it("prefers stderr in probe details", async () => {
    const root = await temp("kilo-tools-root-")
    const bin = await temp("kilo-tools-bin-")
    const git = await script(bin, "git-stderr", `echo "stdout noise"\necho "stderr truth" >&2\nexit 1`)
    const probe = await manager(root, git, "linux").probeGit()
    expect(probe.ok ? "" : probe.detail).toBe("stderr truth")
  })

  it("keeps a probe timeout as the original error", async () => {
    const root = await repo()
    const bin = await temp("kilo-tools-bin-")
    const git = await script(bin, "git-slow", `if [ "$1" = "--version" ]; then sleep 6; fi\nexec "$KILO_REAL_GIT" "$@"`)
    const error = await manager(root, git, "linux")
      .createWorktree({})
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ killed: true, signal: "SIGTERM" })
  }, 20_000)
})

describe("LFS probe", () => {
  it("does not cache an ambiguous git-lfs failure as a missing tool", async () => {
    const root = await temp("kilo-tools-root-")
    const bin = await temp("kilo-tools-bin-")
    const git = await script(
      bin,
      "git-timeout",
      `echo "git $@" >> "$KILO_TOOLS_LOG"\nif [ "$1" = "lfs" ]; then echo "Command timed out after 5000ms" >&2; exit 1; fi\nexit 0`,
    )
    const mgr = manager(root, git, "linux")
    expect(await mgr.probeLfs()).toMatchObject({ ok: false, code: "unknown" })
    expect(await mgr.probeLfs()).toMatchObject({ ok: false, code: "unknown" })
    expect((await calls()).filter((line) => line.startsWith("git lfs version"))).toHaveLength(2)
  })
})

describe("verify probes", () => {
  it("creation re-probes Git instead of trusting the cached positive", async () => {
    const root = await repo()
    const bin = await temp("kilo-tools-bin-")
    const git = await script(bin, "git", `echo "git $@" >> "$KILO_TOOLS_LOG"\nexec "$KILO_REAL_GIT" "$@"`)
    const mgr = manager(root, git, "linux")
    expect(await mgr.probeGit()).toEqual({ ok: true })
    await fs.rm(git)
    await expect(mgr.createWorktree({})).rejects.toThrow(/Git is not installed/)
  })

  it("creation re-probes Git LFS instead of trusting the cached positive", async () => {
    const root = await temp("kilo-tools-root-")
    const bin = await temp("kilo-tools-bin-")
    const mark = path.join(state, "lfs-installed")
    await fs.writeFile(mark, "")
    const git = await script(
      bin,
      "git-lfs-toggle",
      `echo "git $@" >> "$KILO_TOOLS_LOG"\nif [ "$1" = "lfs" ]; then\n  if [ -f ${JSON.stringify(mark)} ]; then echo "git-lfs/3.0"; exit 0; fi\n  echo "git: 'lfs' is not a git command." >&2\n  exit 1\nfi\nexit 0`,
    )
    const mgr = manager(root, git, "linux")
    expect(await mgr.probeLfs()).toEqual({ ok: true })
    await fs.rm(mark)
    expect(await mgr.probeLfs()).toEqual({ ok: true })
    expect(await mgr.checkLfsAvailable()).toBe(false)
  })
})

describe("LFS alias safety", () => {
  it("does not run a repository alias while probing git-lfs", async () => {
    const root = await repo()
    const mark = path.join(state, "alias-ran")
    const real = process.env.KILO_REAL_GIT
    if (!real) throw new Error("KILO_REAL_GIT is required")
    const seeded = Bun.spawnSync([real, "-C", root, "config", "alias.lfs", `!touch ${mark}`])
    expect(seeded.exitCode).toBe(0)

    const tools = await temp("kilo-tools-path-")
    for (const [name, target] of [
      ["sh", "/bin/sh"],
      ["touch", "/usr/bin/touch"],
    ] as const) {
      await fs.symlink(target, path.join(tools, name))
    }
    const previous = process.env.PATH
    process.env.PATH = tools
    try {
      const binary = await fs.access("/usr/bin/git").then(
        () => "/usr/bin/git",
        () => real,
      )
      const mgr = manager(root, binary, "linux")
      expect(await mgr.probeLfs()).toMatchObject({ ok: false, code: "missing" })
      expect(
        await fs.access(mark).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
    } finally {
      process.env.PATH = previous
    }
  })
})

describe("LFS filters", () => {
  it("reads the global filter registration", async () => {
    const root = await temp("kilo-tools-root-")
    const home = await temp("kilo-tools-home-")
    const real = process.env.KILO_REAL_GIT
    if (!real) throw new Error("KILO_REAL_GIT is required")
    const previous = {
      HOME: process.env.HOME,
      GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      NO: process.env.GIT_CONFIG_NOSYSTEM,
    }
    process.env.HOME = home
    delete process.env.GIT_CONFIG_GLOBAL
    process.env.GIT_CONFIG_NOSYSTEM = "1"
    try {
      const mgr = manager(root, real, "linux")
      expect(await mgr.checkLfsFilters()).toBe(false)
      await fs.writeFile(path.join(home, ".gitconfig"), '[filter "lfs"]\n\tprocess = git-lfs filter-process\n')
      expect(await mgr.checkLfsFilters()).toBe(true)
    } finally {
      if (previous.HOME === undefined) delete process.env.HOME
      else process.env.HOME = previous.HOME
      if (previous.GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = previous.GLOBAL
      if (previous.NO === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
      else process.env.GIT_CONFIG_NOSYSTEM = previous.NO
    }
  })

  it("treats a non-unset config failure as advisory", async () => {
    const root = await temp("kilo-tools-root-")
    const bin = await temp("kilo-tools-bin-")
    const git = await script(
      bin,
      "git-config-fail",
      `if [ "$1" = "-c" ]; then shift 2; fi\nif [ "$1" = "config" ]; then exit 128; fi\nexit 0`,
    )
    expect(await manager(root, git, "linux").checkLfsFilters()).toBe(true)
  })

  it("reads a repository-local filter registration", async () => {
    const root = await repo()
    const home = await temp("kilo-tools-home-")
    const real = process.env.KILO_REAL_GIT
    if (!real) throw new Error("KILO_REAL_GIT is required")
    const previous = {
      HOME: process.env.HOME,
      GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      NO: process.env.GIT_CONFIG_NOSYSTEM,
    }
    process.env.HOME = home
    process.env.GIT_CONFIG_NOSYSTEM = "1"
    delete process.env.GIT_CONFIG_GLOBAL
    try {
      const mgr = manager(root, real, "linux")
      expect(await mgr.checkLfsFilters()).toBe(false)
      await fs.appendFile(path.join(root, ".git", "config"), '[filter "lfs"]\n\tprocess = git-lfs filter-process\n')
      expect(await mgr.checkLfsFilters()).toBe(true)
    } finally {
      if (previous.HOME === undefined) delete process.env.HOME
      else process.env.HOME = previous.HOME
      if (previous.GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = previous.GLOBAL
      if (previous.NO === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
      else process.env.GIT_CONFIG_NOSYSTEM = previous.NO
    }
  })
})

describe("fresh tool checks", () => {
  it("refreshes the login-shell PATH only for fresh checks and updates both LFS caches", async () => {
    const root = await temp("kilo-tools-root-")
    const bin = await temp("kilo-tools-bin-")
    const later = await temp("kilo-tools-later-")
    const shellCalls = path.join(state, "shell.log")
    await fs.writeFile(shellCalls, "")
    const shell = await script(
      state,
      "shell",
      `echo x >> "${shellCalls}"\necho "PATH=$(/bin/cat "${path.join(state, "path")}")"`,
    )
    const git = await script(
      bin,
      "git",
      `echo "git $@" >> "$KILO_TOOLS_LOG"\nif [ "$1" = "lfs" ]; then\n  found=$(command -v git-lfs)\n  if [ -n "$found" ]; then exec "$found" version; fi\n  echo "git: 'lfs' is not a git command." >&2\n  exit 1\nfi\nexit 0`,
    )
    await script(later, "git-lfs", `echo "git-lfs/3.0"`)

    const previous = { PATH: process.env.PATH, SHELL: process.env.SHELL }
    process.env.SHELL = shell
    process.env.PATH = bin
    await fs.writeFile(path.join(state, "path"), process.env.PATH)

    try {
      const mgr = manager(root, git, "linux")
      expect(await mgr.probeLfs()).toMatchObject({ ok: false, code: "missing" })
      expect(await mgr.probeLfs()).toMatchObject({ ok: false, code: "missing" })
      expect((await calls()).filter((line) => line.startsWith("git lfs version"))).toHaveLength(1)

      await fs.writeFile(path.join(state, "path"), [later, bin].join(path.delimiter))
      expect(await mgr.probeLfs()).toMatchObject({ ok: false, code: "missing" })
      expect((await fs.readFile(shellCalls, "utf8")).trim()).toBe("")

      expect(await mgr.probeLfs(true)).toEqual({ ok: true })
      expect((await fs.readFile(shellCalls, "utf8")).trim().split("\n")).toHaveLength(1)
      expect(process.env.PATH?.startsWith(later)).toBe(true)
      expect(await mgr.probeLfs()).toEqual({ ok: true })
      expect((await fs.readFile(shellCalls, "utf8")).trim().split("\n")).toHaveLength(1)
    } finally {
      process.env.PATH = previous.PATH
      process.env.SHELL = previous.SHELL
    }
  })
})
