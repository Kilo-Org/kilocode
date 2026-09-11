import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, test } from "bun:test"
import {
  isWindowsBatchFile,
  preferWindowsGuiExecutable,
  spawnNeedsWindowsShell,
  windowsPathExtensions,
} from "../../script/windows-app"

describe("windows launch app", () => {
  test("PATH lookup prefers .exe before .cmd", () => {
    expect(windowsPathExtensions()[0]).toBe(".exe")
    expect(windowsPathExtensions()).toContain(".cmd")
  })

  test("shell is required only for leftover batch files", () => {
    expect(isWindowsBatchFile("C:\\Tools\\code.cmd")).toBe(true)
    expect(isWindowsBatchFile("C:\\Tools\\code.bat")).toBe(true)
    expect(isWindowsBatchFile("C:\\Program Files\\Microsoft VS Code\\Code.exe")).toBe(false)
    expect(spawnNeedsWindowsShell("C:\\Program Files\\Microsoft VS Code\\Code.exe")).toBe(false)
    expect(spawnNeedsWindowsShell("C:\\Scoop\\shims\\code.cmd")).toBe(true)
  })

  test("resolves bin\\code.cmd to sibling Code.exe when it exists", () => {
    const root = join(tmpdir(), `kilo-code-layout-${Date.now()}`)
    const bin = join(root, "bin")
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, "code.cmd"), "@echo off\n")
    writeFileSync(join(root, "Code.exe"), "")
    expect(preferWindowsGuiExecutable(join(bin, "code.cmd"))).toBe(join(root, "Code.exe"))
    rmSync(root, { recursive: true, force: true })
  })

  test("keeps a batch shim when no Code.exe is next to it", () => {
    const cmd = join(tmpdir(), "scoop-shims", "code.cmd")
    expect(preferWindowsGuiExecutable(cmd)).toBe(cmd)
  })
})
