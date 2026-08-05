import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { getShellEnvironment, execWithShellEnv, clearShellEnvCache } from "../../src/agent-manager/shell-env"

let platformDesc: PropertyDescriptor | undefined
const originalTz = process.env.TZ

afterEach(() => {
  clearShellEnvCache()
  if (platformDesc) Object.defineProperty(process, "platform", platformDesc)
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

function setPlatform(value: string) {
  platformDesc = Object.getOwnPropertyDescriptor(process, "platform")
  Object.defineProperty(process, "platform", { value, configurable: true })
}

function fakeGhBin(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-tz-"))
  fs.symlinkSync(process.execPath, path.join(dir, "gh"))
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

describe("getShellEnvironment", () => {
  it("returns an object with PATH", async () => {
    const env = await getShellEnvironment()
    expect(env).toBeDefined()
    expect(typeof env.PATH).toBe("string")
    expect(env.PATH!.length).toBeGreaterThan(0)
  })

  it("returns HOME", async () => {
    const env = await getShellEnvironment()
    expect(typeof env.HOME).toBe("string")
  })

  it("caches results across calls", async () => {
    const first = await getShellEnvironment()
    const second = await getShellEnvironment()
    expect(first.PATH).toBe(second.PATH)
  })

  it("returns a copy (mutations don't corrupt cache)", async () => {
    const first = await getShellEnvironment()
    first.PATH = "/mutated"
    const second = await getShellEnvironment()
    expect(second.PATH).not.toBe("/mutated")
  })

  it("handles multiline env values without corrupting PATH", async () => {
    // PATH should never contain newlines — verify it parses correctly
    // even if other env vars have multiline values (e.g. BASH_FUNC_*)
    const env = await getShellEnvironment()
    expect(env.PATH).toBeDefined()
    expect(env.PATH).not.toContain("\n")
  })
})

describe("execWithShellEnv", () => {
  it("executes a simple command", async () => {
    const { stdout } = await execWithShellEnv("echo", ["hello"])
    expect(stdout.trim()).toBe("hello")
  })

  it("passes cwd option through", async () => {
    const { stdout } = await execWithShellEnv("pwd", [], { cwd: "/tmp" })
    // /tmp may resolve to /private/tmp on macOS
    expect(stdout.trim()).toMatch(/\/tmp$/)
  })

  it("throws on non-ENOENT errors", async () => {
    await expect(execWithShellEnv("ls", ["--nonexistent-flag-that-fails"])).rejects.toThrow()
  })

  it("concurrent calls don't reject prematurely", async () => {
    // Both calls should succeed — neither should throw due to a race
    const [a, b] = await Promise.all([execWithShellEnv("echo", ["first"]), execWithShellEnv("echo", ["second"])])
    expect(a.stdout.trim()).toBe("first")
    expect(b.stdout.trim()).toBe("second")
  })
})

describe("clearShellEnvCache", () => {
  it("forces fresh resolution on next call", async () => {
    const first = await getShellEnvironment()
    clearShellEnvCache()
    const second = await getShellEnvironment()
    // Both should succeed and contain PATH
    expect(first.PATH).toBeDefined()
    expect(second.PATH).toBeDefined()
  })
})

describe("execWithShellEnv TZ for gh on Windows", () => {
  it("injects TZ into gh child processes on Windows", async () => {
    setPlatform("win32")
    process.env.TZ = "Test/TZ"
    const { dir, cleanup } = fakeGhBin()
    try {
      const { stdout } = await execWithShellEnv("gh", ["-e", "console.log(process.env.TZ)"], {
        env: { PATH: dir },
      })
      expect(stdout.trim()).toBe("Test/TZ")
    } finally {
      cleanup()
    }
  })

  it("infers a TZ value from the system when process.env.TZ is not set", async () => {
    setPlatform("win32")
    delete process.env.TZ
    const { dir, cleanup } = fakeGhBin()
    try {
      const { stdout } = await execWithShellEnv("gh", ["-e", "console.log(process.env.TZ)"], {
        env: { PATH: dir },
      })
      expect(stdout.trim()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    } finally {
      cleanup()
    }
  })

  it("does not inject TZ for non-gh commands on Windows", async () => {
    setPlatform("win32")
    process.env.TZ = "Test/TZ"
    const { dir, cleanup } = fakeGhBin()
    try {
      fs.symlinkSync(process.execPath, path.join(dir, "git"))
      const { stdout } = await execWithShellEnv("git", ["-e", "console.log(process.env.TZ)"], {
        env: { PATH: dir },
      })
      expect(stdout.trim()).toBe("undefined")
    } finally {
      cleanup()
    }
  })

  it("does not inject TZ for gh on non-Windows platforms", async () => {
    setPlatform("linux")
    process.env.TZ = "Test/TZ"
    const { dir, cleanup } = fakeGhBin()
    try {
      const { stdout } = await execWithShellEnv("gh", ["-e", "console.log(process.env.TZ)"], {
        env: { PATH: dir },
      })
      expect(stdout.trim()).toBe("undefined")
    } finally {
      cleanup()
    }
  })

  it("preserves an explicit TZ in options.env", async () => {
    setPlatform("win32")
    process.env.TZ = "Test/TZ"
    const { dir, cleanup } = fakeGhBin()
    try {
      const { stdout } = await execWithShellEnv("gh", ["-e", "console.log(process.env.TZ)"], {
        env: { PATH: dir, TZ: "Custom/Zone" },
      })
      expect(stdout.trim()).toBe("Custom/Zone")
    } finally {
      cleanup()
    }
  })
})
