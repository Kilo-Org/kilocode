import { describe, expect, it } from "bun:test"
import { createGitExecutable } from "../../src/util/git-executable"

describe("createGitExecutable", () => {
  it("preserves PATH lookup on other platforms", async () => {
    const git = createGitExecutable({
      platform: "linux",
      run: async () => {
        throw new Error("should not run")
      },
    })

    expect(await git()).toBe("git")
  })

  it("resolves and validates the real macOS Git executable", async () => {
    const calls: string[] = []
    const git = createGitExecutable({
      platform: "darwin",
      path: "/usr/bin:/bin",
      access: async () => undefined,
      realpath: async (file) => file,
      run: async (cmd, args) => {
        calls.push([cmd, ...args].join(" "))
        if (cmd === "/usr/bin/xcrun") return { stdout: "/Library/Developer/CommandLineTools/usr/bin/git\n" }
        return { stdout: "git version 2.50.1\n" }
      },
    })

    expect(await git()).toBe("/Library/Developer/CommandLineTools/usr/bin/git")
    expect(calls).toEqual(["/usr/bin/xcrun --find git", "/Library/Developer/CommandLineTools/usr/bin/git --version"])
  })

  it("falls back to the macOS launcher when resolution fails", async () => {
    const git = createGitExecutable({
      platform: "darwin",
      path: "/usr/bin",
      access: async () => undefined,
      realpath: async (file) => file,
      run: async () => {
        throw new Error("xcrun failed")
      },
    })

    expect(await git()).toBe("git")
  })

  it("rejects a resolved command that is not Git", async () => {
    const git = createGitExecutable({
      platform: "darwin",
      path: "/usr/bin",
      access: async () => undefined,
      realpath: async (file) => file,
      run: async (cmd) =>
        cmd === "/usr/bin/xcrun" ? { stdout: "/tmp/not-git\n" } : { stdout: "unexpected command\n" },
    })

    expect(await git()).toBe("git")
  })

  it("does not override a non-Apple Git selected by PATH", async () => {
    let calls = 0
    const git = createGitExecutable({
      platform: "darwin",
      path: "/opt/homebrew/bin:/usr/bin",
      access: async () => undefined,
      realpath: async (file) => file,
      run: async () => {
        calls++
        return { stdout: "" }
      },
    })

    expect(await git()).toBe("git")
    expect(calls).toBe(0)
  })

  it("keeps per-command lookup for relative PATH entries", async () => {
    let calls = 0
    const git = createGitExecutable({
      platform: "darwin",
      path: "./bin:/usr/bin",
      run: async () => {
        calls++
        return { stdout: "" }
      },
    })

    expect(await git()).toBe("git")
    expect(calls).toBe(0)
  })

  it("keeps per-command lookup for empty PATH entries", async () => {
    let calls = 0
    const git = createGitExecutable({
      platform: "darwin",
      path: ":/usr/bin",
      run: async () => {
        calls++
        return { stdout: "" }
      },
    })

    expect(await git()).toBe("git")
    expect(calls).toBe(0)
  })

  it("keeps PATH lookup when the developer directory contains unsafe path characters", async () => {
    const git = createGitExecutable({
      platform: "darwin",
      path: "/usr/bin",
      access: async () => undefined,
      realpath: async (file) => file,
      run: async () => ({ stdout: "/Applications/Xcode Beta.app/Contents/Developer/usr/bin/git\n" }),
    })

    expect(await git()).toBe("git")
  })

  it("shares one resolution across concurrent callers", async () => {
    let calls = 0
    const git = createGitExecutable({
      platform: "darwin",
      path: "/usr/bin",
      access: async () => undefined,
      realpath: async (file) => file,
      run: async (cmd) => {
        calls++
        return cmd === "/usr/bin/xcrun"
          ? { stdout: "/Library/Developer/CommandLineTools/usr/bin/git\n" }
          : { stdout: "git version 2.50.1\n" }
      },
    })

    expect(await Promise.all([git(), git(), git()])).toEqual([
      "/Library/Developer/CommandLineTools/usr/bin/git",
      "/Library/Developer/CommandLineTools/usr/bin/git",
      "/Library/Developer/CommandLineTools/usr/bin/git",
    ])
    expect(calls).toBe(2)
  })
})
