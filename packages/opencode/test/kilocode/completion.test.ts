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

  test("emits the PowerShell script under a pwsh module path", async () => {
    const proc = spawn(["completion"], { PSModulePath: "/opt/microsoft/powershell/7/Modules" })
    const stdout = await new Response(proc.stdout).text()
    await proc.exited
    expect(stdout).toContain("Register-ArgumentCompleter -CommandName kilo -Native -ScriptBlock")
    expect(stdout).toContain("--get-yargs-completions")
    expect(stdout).toContain("kilo completion >> $PROFILE")
    expect(stdout).toContain("###-end-kilo-completions-###")
    // The bash builtin must not leak into the PowerShell script
    expect(stdout).not.toContain("complete -o bashdefault")
  })

  test("delegates to the yargs builtin for cmd-inherited legacy module paths", async () => {
    const proc = spawn(["completion"], {
      PSModulePath: "C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules",
      SHELL: "/bin/bash",
    })
    const stdout = await new Response(proc.stdout).text()
    await proc.exited
    expect(stdout).toContain("complete -o bashdefault")
    expect(stdout).not.toContain("Register-ArgumentCompleter")
  })

  test("detects PowerShell hosts without trusting the machine-wide module path", () => {
    // pwsh installs and per-user module directories are PowerShell parents
    process.env.PSModulePath = "C:\\Program Files\\PowerShell\\7\\Modules"
    expect(KiloCompletion.powerShell()).toBe(true)
    // The Windows Store install flavors the directory name with a version suffix
    process.env.PSModulePath = "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.4.6_x64__8weky\\Modules"
    expect(KiloCompletion.powerShell()).toBe(true)
    delete process.env.PSModulePath
    // The legacy machine-wide list is inherited by cmd.exe and Git Bash too
    process.env.PSModulePath = "C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules"
    expect(KiloCompletion.powerShell()).toBe(false)
    // A pwsh login shell shows up in SHELL even without module paths
    delete process.env.PSModulePath
    process.env.SHELL = "/usr/bin/pwsh"
    expect(KiloCompletion.powerShell()).toBe(true)
  })

  test("intercepts only the completion command in PowerShell hosts", () => {
    process.env.PSModulePath = "C:\\Program Files\\PowerShell\\7\\Modules"
    expect(KiloCompletion.intercept(["serve"])).toBe(false)
    delete process.env.PSModulePath
    expect(KiloCompletion.intercept(["completion"])).toBe(false)
  })

  test("script mirrors the yargs bash word contract", () => {
    expect(KiloCompletion.script()).toContain("if ($raw -match '\\s$') { $words += '' }")
    expect(KiloCompletion.script()).toContain("kilo --get-yargs-completions @words")
    // Literal, case-sensitive prefix matching instead of -like wildcards
    expect(KiloCompletion.script()).toContain('StartsWith($wordToComplete, [System.StringComparison]::Ordinal)')
    expect(KiloCompletion.script()).not.toContain("-like")
  })
})
