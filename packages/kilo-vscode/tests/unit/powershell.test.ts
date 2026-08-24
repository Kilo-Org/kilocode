import { describe, it, expect } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { locations, powershellCommand, pwshPath } from "../../src/util/powershell"

describe("powershellCommand", () => {
  it("lists known Windows install locations in priority order", () => {
    expect(
      locations({
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
      }),
    ).toEqual([
      path.join("C:\\Program Files", "PowerShell", "7", "pwsh.exe"),
      path.join("C:\\Program Files (x86)", "PowerShell", "7", "pwsh.exe"),
      path.join("C:\\Users\\u\\AppData\\Local", "Microsoft", "WindowsApps", "pwsh.exe"),
    ])
    expect(locations({})).toEqual([])
  })

  it("falls back to legacy powershell.exe when nothing is found", () => {
    expect(powershellCommand({ PATH: "" })).toBe("powershell.exe")
  })

  it("prefers a pwsh.exe found on the injected PATH", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pwsh-path-"))
    try {
      const file = path.join(root, "pwsh.exe")
      fs.writeFileSync(file, "")
      expect(pwshPath({ PATH: root })).toBe(file)
      expect(powershellCommand({ PATH: root })).toBe(file)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
