import { afterEach, describe, expect, it } from "bun:test"
import {
  getShellEnvironment,
  execWithShellEnv,
  clearShellEnvCache,
  parseEnvOutput,
} from "../../src/agent-manager/shell-env"

afterEach(() => {
  clearShellEnvCache()
})

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

describe("parseEnvOutput", () => {
  it("does not append trailing newline to last variable value", () => {
    const input = "FOO=bar\nPATH=/usr/bin:/bin\n"
    const result = parseEnvOutput(input)
    expect(result.FOO).toBe("bar")
    expect(result.PATH).toBe("/usr/bin:/bin")
    // The bug: without trimEnd(), the trailing \n causes PATH to get "\n" appended
    expect(result.PATH).not.toContain("\n")
  })

  it("handles multiline values correctly", () => {
    const input = "SIMPLE=hello\nMULTI=line1\nline2\nline3\nPATH=/usr/bin\n"
    const result = parseEnvOutput(input)
    expect(result.SIMPLE).toBe("hello")
    expect(result.MULTI).toBe("line1\nline2\nline3")
    expect(result.PATH).toBe("/usr/bin")
  })

  it("handles empty input", () => {
    const result = parseEnvOutput("")
    expect(Object.keys(result).length).toBe(0)
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
