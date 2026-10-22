import { describe, expect, it } from "bun:test"
import { createGitExecutable } from "../../src/util/git-executable"

describe("createGitExecutable", () => {
  it("uses the configured Git executable on Windows", async () => {
    const git = createGitExecutable({
      platform: "win32",
      preferred: async () => "C:\\Program Files\\Git\\cmd\\git.exe",
    })

    expect(await git()).toBe("C:\\Program Files\\Git\\cmd\\git.exe")
  })

  it("falls back to PATH when the preferred Windows executable is missing", async () => {
    const git = createGitExecutable({
      platform: "win32",
      preferred: async () => undefined,
    })

    expect(await git()).toBe("git")
  })

  it("logs and falls back to PATH when preferred Windows resolution fails", async () => {
    const messages: string[] = []
    const git = createGitExecutable({
      platform: "win32",
      preferred: async () => {
        throw new Error("Git API unavailable")
      },
      log: (message) => messages.push(message),
    })

    expect(await git()).toBe("git")
    expect(messages).toEqual(["Unable to resolve the preferred Git executable, using PATH: Error: Git API unavailable"])
  })

  it("falls back to PATH when preferred Windows resolution hangs", async () => {
    const messages: string[] = []
    let calls = 0
    const git = createGitExecutable({
      platform: "win32",
      timeout: 10,
      preferred: () => {
        calls++
        return new Promise<string>(() => undefined)
      },
      log: (message) => messages.push(message),
    })

    expect(await Promise.all([git(), git(), git()])).toEqual(["git", "git", "git"])
    expect(await git()).toBe("git")
    expect(calls).toBe(1)
    expect(messages).toEqual([
      "Unable to resolve the preferred Git executable, using PATH: Error: VS Code Git activation timed out after 10ms",
    ])
  }, 1_000)

  it("keeps the PATH fallback when preferred Windows resolution rejects after timeout", async () => {
    const messages: string[] = []
    let reject!: (error: Error) => void
    const pending = new Promise<string>((_, fail) => {
      reject = fail
    })
    const git = createGitExecutable({
      platform: "win32",
      timeout: 10,
      preferred: () => pending,
      log: (message) => messages.push(message),
    })

    expect(await git()).toBe("git")
    reject(new Error("Late Git activation failure"))
    await Bun.sleep(0)
    expect(await git()).toBe("git")
    expect(messages).toHaveLength(1)
  }, 1_000)

  it("keeps the preferred Windows executable after its timeout deadline", async () => {
    const messages: string[] = []
    const git = createGitExecutable({
      platform: "win32",
      timeout: 10,
      preferred: async () => "C:\\Program Files\\Git\\cmd\\git.exe",
      log: (message) => messages.push(message),
    })

    expect(await git()).toBe("C:\\Program Files\\Git\\cmd\\git.exe")
    await Bun.sleep(20)
    expect(await git()).toBe("C:\\Program Files\\Git\\cmd\\git.exe")
    expect(messages).toEqual([])
  })

  it("caches the preferred Windows executable", async () => {
    let calls = 0
    const git = createGitExecutable({
      platform: "win32",
      preferred: async () => {
        calls++
        return "C:\\Git\\git.exe"
      },
    })

    expect(await Promise.all([git(), git(), git()])).toEqual([
      "C:\\Git\\git.exe",
      "C:\\Git\\git.exe",
      "C:\\Git\\git.exe",
    ])
    expect(calls).toBe(1)
  })

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
