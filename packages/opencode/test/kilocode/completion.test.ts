import { describe, test, expect, beforeEach } from "bun:test"
import path from "path"
import { KiloCompletion } from "../../src/kilocode/cli/completion"

const entry = path.join(process.cwd(), "src/index.ts")

function spawn(args: string[], envOverride: Record<string, string | undefined>) {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  for (const [key, value] of Object.entries(envOverride)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return Bun.spawn([process.execPath, "--conditions=browser", entry, ...args], {
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
}

describe("KiloCompletion", () => {
  beforeEach(() => {
    delete process.env.PSModulePath
    delete process.env.SHELL
  })

  test("emits the PowerShell script under PSModulePath", async () => {
    const proc = spawn(["completion"], { PSModulePath: "/some/path/pwsh" })
    const stdout = await new Response(proc.stdout).text()
    await proc.exited
    expect(stdout).toContain("Register-ArgumentCompleter -CommandName kilo -ScriptBlock")
    expect(stdout).toContain("--get-yargs-completions")
    expect(stdout).toContain("kilo completion >> $PROFILE")
    expect(stdout).toContain("###-end-kilo-completions-###")
  })

  test("delegates to the yargs builtin outside PowerShell", async () => {
    const proc = spawn(["completion"], { PSModulePath: undefined, SHELL: "/bin/bash" })
    const stdout = await new Response(proc.stdout).text()
    await proc.exited
    expect(stdout).toContain("###-begin-kilo-completions-###")
    expect(stdout).not.toContain("Register-ArgumentCompleter")
  })

  test("detects PowerShell hosts by PSModulePath or a pwsh SHELL", () => {
    expect(KiloCompletion.powerShell()).toBe(false)
    process.env.SHELL = "/bin/zsh"
    expect(KiloCompletion.powerShell()).toBe(false)
    delete process.env.SHELL
    process.env.PSModulePath = "/foo/bar/NaturalShell"
    expect(KiloCompletion.powerShell()).toBe(true)
    delete process.env.PSModulePath
    process.env.SHELL = "/usr/bin/pwsh"
    expect(KiloCompletion.powerShell()).toBe(true)
  })

  test("intercepts only the completion command in PowerShell hosts", () => {
    process.env.PSModulePath = "/foo/bar/NaturalShell"
    expect(KiloCompletion.intercept(["serve"])).toBe(false)
    delete process.env.PSModulePath
    expect(KiloCompletion.intercept(["completion"])).toBe(false)
  })

  test("script mirrors the yargs bash word contract", () => {
    expect(KiloCompletion.script()).toContain("if ($raw -match '\\s$') { $words += '' }")
    expect(KiloCompletion.script()).toContain("kilo --get-yargs-completions @words")
  })
})
