import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { SetupScriptService } from "../SetupScriptService"

function setupRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kilo-setup-script-"))
}

function scriptPath(root: string, name: string): string {
  return path.join(root, ".kilo", name)
}

function writeScript(root: string, name: string, content = "echo ok\n"): string {
  const dir = path.join(root, ".kilo")
  fs.mkdirSync(dir, { recursive: true })
  const script = path.join(dir, name)
  fs.writeFileSync(script, content, "utf-8")
  return script
}

describe("SetupScriptService", () => {
  it("resolves POSIX setup script on macOS", () => {
    const root = setupRoot()
    try {
      const file = writeScript(root, "setup-script")
      const service = new SetupScriptService(root)
      const resolved = service.resolveScript("darwin")
      expect(resolved).toEqual({
        path: file,
        kind: "posix",
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("prefers PowerShell script on Windows when multiple variants exist", () => {
    const root = setupRoot()
    try {
      const ps1 = writeScript(root, "setup-script.ps1")
      writeScript(root, "setup-script.cmd")
      writeScript(root, "setup-script")
      const service = new SetupScriptService(root)
      const resolved = service.resolveScript("win32")
      expect(resolved).toEqual({
        path: ps1,
        kind: "powershell",
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("resolves cmd script on Windows when no PowerShell script exists", () => {
    const root = setupRoot()
    try {
      const cmd = writeScript(root, "setup-script.cmd")
      const service = new SetupScriptService(root)
      const resolved = service.resolveScript("win32")
      expect(resolved).toEqual({
        path: cmd,
        kind: "cmd",
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("does not resolve POSIX setup scripts on Windows", () => {
    const root = setupRoot()
    try {
      writeScript(root, "setup-script")
      writeScript(root, "setup-script.sh")
      const service = new SetupScriptService(root)
      const resolved = service.resolveScript("win32")
      expect(resolved).toBeUndefined()
      expect(service.hasScript("win32")).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("creates default PowerShell script on Windows", async () => {
    const root = setupRoot()
    try {
      const service = new SetupScriptService(root)
      await service.createDefaultScript("win32")
      const file = scriptPath(root, "setup-script.ps1")
      expect(fs.existsSync(file)).toBe(true)
      expect(service.hasScript("win32")).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("creates default POSIX script on macOS", async () => {
    const root = setupRoot()
    try {
      const service = new SetupScriptService(root)
      await service.createDefaultScript("darwin")
      const file = scriptPath(root, "setup-script")
      expect(fs.existsSync(file)).toBe(true)
      expect(service.hasScript("darwin")).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
