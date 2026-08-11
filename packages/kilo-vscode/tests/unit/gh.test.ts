import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { execGhRead } from "../../src/agent-manager/gh"

const host = process.platform
const platform = Object.getOwnPropertyDescriptor(process, "platform")

function setPlatform(value: string): void {
  Object.defineProperty(process, "platform", { value, configurable: true })
}

function link(src: string, dest: string): void {
  try {
    fs.linkSync(src, dest)
  } catch {
    fs.copyFileSync(src, dest)
  }
  if (host !== "win32") fs.chmodSync(dest, 0o755)
}

function fakeBin(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-process-"))
  const name = host === "win32" ? "gh.exe" : "gh"
  try {
    link(process.execPath, path.join(dir, name))
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

function env(dir: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") result[key] = value
  }
  const key = Object.keys(result).find((key) => key.toLowerCase() === "path") ?? "PATH"
  result[key] = dir
  result.PATHEXT = ".COM;.EXE;.BAT;.CMD"
  return result
}

function unset(env: Record<string, string>, name: string): void {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === name.toLowerCase()) delete env[key]
  }
}

afterEach(() => {
  if (platform) Object.defineProperty(process, "platform", platform)
})

describe("execGhRead", () => {
  it("uses UTC when TZ is unset on Windows", async () => {
    setPlatform("win32")
    const bin = fakeBin()
    try {
      const child = env(bin.dir)
      unset(child, "TZ")
      const { stdout } = await execGhRead(["-e", "console.log(process.env.TZ)"], { env: child })
      expect(stdout.trim()).toBe("UTC")
    } finally {
      bin.cleanup()
    }
  })

  it("preserves an existing TZ on Windows", async () => {
    setPlatform("win32")
    const bin = fakeBin()
    try {
      const child = env(bin.dir)
      child.TZ = "Europe/London"
      const { stdout } = await execGhRead(["-e", "console.log(process.env.TZ)"], { env: child })
      expect(stdout.trim()).toBe("Europe/London")
    } finally {
      bin.cleanup()
    }
  })

  it("does not add TZ on non-Windows platforms", async () => {
    setPlatform("linux")
    const bin = fakeBin()
    try {
      const child = env(bin.dir)
      unset(child, "TZ")
      const { stdout } = await execGhRead(["-e", "console.log(process.env.TZ)"], { env: child })
      expect(stdout.trim()).toBe("undefined")
    } finally {
      bin.cleanup()
    }
  })
})
