import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { buildRunTaskCommand, RunScriptService } from "../../src/agent-manager/run/service"

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "run-script-service-test-"))
}

describe("RunScriptService", () => {
  let root: string
  let dir: string

  beforeEach(() => {
    root = tmpdir()
    dir = path.join(root, ".kilo")
    fs.mkdirSync(dir)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("resolves posix run-script before run-script.sh", () => {
    const bare = path.join(dir, "run-script")
    fs.writeFileSync(bare, "bun test")
    fs.writeFileSync(path.join(dir, "run-script.sh"), "npm test")

    expect(new RunScriptService(root).resolveScript("darwin")).toEqual({ path: bare, kind: "posix" })
  })

  it("resolves Windows scripts by PowerShell, CMD, then BAT priority", () => {
    const ps = path.join(dir, "run-script.ps1")
    fs.writeFileSync(ps, "bun test")
    fs.writeFileSync(path.join(dir, "run-script.cmd"), "bun test")
    fs.writeFileSync(path.join(dir, "run-script.bat"), "bun test")

    expect(new RunScriptService(root).resolveScript("win32")).toEqual({ path: ps, kind: "powershell" })
  })

  it("returns undefined when no platform script exists", () => {
    expect(new RunScriptService(root).resolveTask("linux")).toBeUndefined()
  })

  it("creates a platform default script", async () => {
    fs.rmSync(dir, { recursive: true, force: true })

    await new RunScriptService(root).createDefaultScript("win32")

    const file = path.join(dir, "run-script.ps1")
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.readFileSync(file, "utf-8")).toContain("bun run dev")
  })

  it("builds commands for shell, PowerShell, and CMD scripts", () => {
    expect(buildRunTaskCommand({ path: "/tmp/run-script", kind: "posix" })).toEqual({
      command: "sh",
      args: ["/tmp/run-script"],
    })
    expect(buildRunTaskCommand({ path: "C:\\repo\\.kilo\\run-script.ps1", kind: "powershell" })).toEqual({
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\repo\\.kilo\\run-script.ps1"],
    })
    expect(buildRunTaskCommand({ path: "C:\\repo path\\.kilo\\run-script.cmd", kind: "cmd" })).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", '"C:\\repo path\\.kilo\\run-script.cmd"'],
    })
  })

  it("rejects directories masquerading as run-script", () => {
    fs.mkdirSync(path.join(dir, "run-script"))
    expect(new RunScriptService(root).resolveScript("darwin")).toBeUndefined()
  })

  it("rejects symlinks pointing outside the .kilo directory", () => {
    const outside = path.join(root, "evil.sh")
    fs.writeFileSync(outside, "echo pwned")
    fs.symlinkSync(outside, path.join(dir, "run-script"))
    expect(new RunScriptService(root).resolveScript("darwin")).toBeUndefined()
  })

  it("accepts symlinks pointing inside the .kilo directory", () => {
    const target = path.join(dir, "real-script")
    fs.writeFileSync(target, "bun test")
    fs.symlinkSync(target, path.join(dir, "run-script"))
    const result = new RunScriptService(root).resolveScript("darwin")
    expect(result).toBeDefined()
    expect(result!.kind).toBe("posix")
  })

  it("does not overwrite an existing script on createDefaultScript", async () => {
    fs.writeFileSync(path.join(dir, "run-script"), "custom content")
    await new RunScriptService(root).createDefaultScript("darwin")
    expect(fs.readFileSync(path.join(dir, "run-script"), "utf-8")).toBe("custom content")
  })
})
