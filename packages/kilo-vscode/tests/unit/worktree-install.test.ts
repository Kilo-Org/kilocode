import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { lookup } from "../../src/agent-manager/path-lookup"
import {
  DOWNLOAD,
  detectInstaller,
  installTool,
  type InstallCommand,
  type InstallDeps,
  type Tool,
  type ToolProbe,
} from "../../src/agent-manager/worktree-install"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function bin(dir: string, name: string) {
  const file = path.join(dir, name)
  await fs.writeFile(file, "#!/bin/sh\nexit 0\n")
  await fs.chmod(file, 0o755)
  return file
}

async function dir() {
  const made = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-install-"))
  dirs.push(made)
  return made
}

function deps(
  platform: NodeJS.Platform,
  envPath: string,
  run: (name: string, command: InstallCommand) => Promise<number | undefined>,
  options: { probe?: (kind: Tool, fresh: boolean) => Promise<ToolProbe>; open?: (url: string) => void } = {},
): InstallDeps {
  return {
    platform,
    env: { ...process.env, PATH: envPath },
    git: "/selected/git",
    run,
    open: options.open ?? (() => {}),
    probe: options.probe ?? (async () => ({ ok: true })),
  }
}

describe("installer detection", () => {
  it("resolves only allowlisted managers from the explicit PATH", async () => {
    const apt = await dir()
    await bin(apt, "apt-get")
    expect(await detectInstaller("git", "linux", { PATH: apt })).toBe("apt")
    expect(await detectInstaller("lfs", "linux", { PATH: apt })).toBe("apt")

    const dnf = await dir()
    await bin(dnf, "dnf")
    expect(await detectInstaller("git", "linux", { PATH: dnf })).toBe("dnf")
    expect(await detectInstaller("git", "linux", { PATH: await dir() })).toBeUndefined()
  })

  it("ignores a directory named like the tool on PATH", async () => {
    const tools = await dir()
    await fs.mkdir(path.join(tools, "git"))
    expect(await lookup("git", { PATH: tools }, "linux")).toBeUndefined()
    await fs.rm(path.join(tools, "git"), { recursive: true, force: true })
    await bin(tools, "git")
    expect(await lookup("git", { PATH: tools }, "linux")).toBe(path.join(tools, "git"))
  })

  it("uses Apple's launcher for Git on macOS and brew for LFS", async () => {
    const mac = await dir()
    await bin(mac, "xcode-select")
    await bin(mac, "brew")
    expect(await detectInstaller("git", "darwin", { PATH: mac })).toBe("apple")
    expect(await detectInstaller("lfs", "darwin", { PATH: mac })).toBe("brew")
  })

  it("pins winget to its source", async () => {
    const win = await dir()
    await bin(win, "winget.EXE")
    const calls: InstallCommand[] = []
    await installTool(
      "git",
      await dir(),
      deps("win32", win, async (_name, command) => {
        calls.push(command)
        return 0
      }),
    )
    expect(calls[0]).toMatchObject({
      command: "winget",
      args: ["install", "-e", "--id", "Git.Git", "--source", "winget"],
    })
  })

  it("reads Windows Path and PathExt case-insensitively", async () => {
    const win = await dir()
    await bin(win, "winget.CMD")
    expect(await detectInstaller("git", "win32", { Path: win, PathExt: ".EXE;.CMD" })).toBe("winget")
    expect(await detectInstaller("git", "win32", { Path: win, PathExt: ".EXE" })).toBeUndefined()
  })
})

describe("install outcomes", () => {
  it("runs the visible package then the lfs setup step", async () => {
    const linux = await dir()
    await bin(linux, "apt-get")
    const calls: Array<{ name: string; command: InstallCommand }> = []
    const outcome = await installTool(
      "lfs",
      await dir(),
      deps("linux", linux, async (name, command) => {
        calls.push({ name, command })
        return 0
      }),
    )

    expect(outcome).toEqual({ kind: "lfs", mode: "terminal", ok: true })
    expect(calls.map((call) => call.name)).toEqual(["Install Git LFS", "Set up Git LFS"])
    expect(calls[0]?.command).toMatchObject({ command: "sudo", args: ["apt-get", "install", "-y", "git-lfs"] })
    expect(calls[1]?.command).toMatchObject({
      command: "/selected/git",
      args: ["lfs", "install"],
      cwd: os.tmpdir(),
    })
  })

  it.each([
    ["non-zero but visible", async () => 1, true, { ok: true }],
    ["stopped but visible", async () => undefined, true, { ok: true }],
    ["non-zero and missing", async () => 1, false, { ok: false, code: 1 }],
    ["stopped and missing", async () => undefined, false, { ok: false, stopped: true }],
    [
      "start failure but visible",
      async () => {
        throw new Error("terminal could not start")
      },
      true,
      { ok: true },
    ],
    [
      "start failure and missing",
      async () => {
        throw new Error("terminal could not start")
      },
      false,
      { ok: false, error: "terminal could not start" },
    ],
  ])("Git install: %s", async (_name, run, present, expected) => {
    const linux = await dir()
    await bin(linux, "apt-get")
    const outcome = await installTool(
      "git",
      await dir(),
      deps("linux", linux, run, {
        probe: async () => (present ? { ok: true } : { ok: false, code: "missing", detail: "not installed" }),
      }),
    )
    expect(outcome).toEqual({ kind: "git", mode: "terminal", ...expected })
  })

  it("leaves an invisible install with no lfs setup run", async () => {
    const linux = await dir()
    await bin(linux, "apt-get")
    const calls: string[] = []
    const outcome = await installTool(
      "lfs",
      await dir(),
      deps(
        "linux",
        linux,
        async (name) => {
          calls.push(name)
          return 0
        },
        { probe: async () => ({ ok: false, code: "missing", detail: "not installed" }) },
      ),
    )
    expect(outcome).toEqual({ kind: "lfs", mode: "terminal", ok: true })
    expect(calls).toEqual(["Install Git LFS"])
  })

  it("reports a failed package step without running the lfs setup", async () => {
    const linux = await dir()
    await bin(linux, "apt-get")
    const calls: string[] = []
    const outcome = await installTool(
      "lfs",
      await dir(),
      deps(
        "linux",
        linux,
        async (name) => {
          calls.push(name)
          return 1
        },
        { probe: async () => ({ ok: false, code: "missing", detail: "not installed" }) },
      ),
    )
    expect(outcome).toEqual({ kind: "lfs", mode: "terminal", ok: false, code: 1 })
    expect(calls).toEqual(["Install Git LFS"])
  })

  it.each([
    ["failed", async () => 1, { ok: false, code: 1 }],
    ["stopped", async () => undefined, { ok: false, stopped: true }],
  ])("reports a %s LFS package step", async (_name, setup, expected) => {
    const linux = await dir()
    await bin(linux, "apt-get")
    const calls: string[] = []
    const outcome = await installTool(
      "lfs",
      await dir(),
      deps(
        "linux",
        linux,
        async (name) => {
          calls.push(name)
          return setup()
        },
        { probe: async () => ({ ok: false, code: "missing", detail: "gone" }) },
      ),
    )
    expect(outcome).toEqual({ kind: "lfs", mode: "terminal", ...expected })
    expect(calls).toEqual(["Install Git LFS"])
  })

  it("uses the explicit env for both LFS steps", async () => {
    const linux = await dir()
    await bin(linux, "apt-get")
    const calls: InstallCommand[] = []
    const outcome = await installTool(
      "lfs",
      await dir(),
      deps("linux", linux, async (_name, command) => {
        calls.push(command)
        return 0
      }),
    )
    expect(outcome).toEqual({ kind: "lfs", mode: "terminal", ok: true })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.env).toEqual(
      Object.fromEntries(
        Object.entries({ ...process.env, PATH: linux }).filter((entry) => typeof entry[1] === "string"),
      ),
    )
    expect(calls[1]?.env).toEqual(calls[0]?.env)
  })

  it("launches Apple's installer when macOS has no Git", async () => {
    const mac = await dir()
    await bin(mac, "xcode-select")
    const calls: InstallCommand[] = []
    const outcome = await installTool(
      "git",
      await dir(),
      deps(
        "darwin",
        mac,
        async (_name, command) => {
          calls.push(command)
          return 0
        },
        { probe: async () => ({ ok: false, code: "missing", detail: "no tools" }) },
      ),
    )
    expect(outcome).toEqual({ kind: "git", mode: "apple", ok: true })
    expect(calls).toEqual([expect.objectContaining({ command: "xcode-select", args: ["--install"], mode: "launcher" })])
  })

  it("keeps an Apple launcher failure instead of showing a fake in-progress state", async () => {
    const mac = await dir()
    await bin(mac, "xcode-select")
    const outcome = await installTool(
      "git",
      await dir(),
      deps("darwin", mac, async () => 2, { probe: async () => ({ ok: false, code: "missing", detail: "no tools" }) }),
    )
    expect(outcome).toMatchObject({ kind: "git", mode: "apple", ok: false, error: "xcode-select exited with code 2" })
  })

  it("opens the download page when no manager exists", async () => {
    const opened: string[] = []
    for (const kind of ["git", "lfs"] as const) {
      const empty = await dir()
      const outcome = await installTool(
        kind,
        await dir(),
        deps("linux", empty, async () => 0, { open: (url) => opened.push(url) }),
      )
      expect(outcome).toEqual({ kind, mode: "external", ok: false })
    }
    expect(opened).toEqual([DOWNLOAD.git, DOWNLOAD.lfs])
  })
})
