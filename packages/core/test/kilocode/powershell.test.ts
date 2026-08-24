import { describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import path from "path"
import { Shell } from "@opencode-ai/core/shell"
import { which } from "@opencode-ai/core/util/which"

const LEGACY = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"

const knownLocations = () => {
  const roots = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "PowerShell", "7"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "PowerShell", "7"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps"),
  ].filter((item): item is string => Boolean(item))
  return roots.map((root) => path.join(root, "pwsh.exe")).filter((file) => existsSync(file))
}

const pwshInstalled = () => Boolean(which("pwsh")) || knownLocations().length > 0

// Remove every PATH directory that can resolve pwsh or powershell so detection
// cannot fall back to PATH lookup and must find installs on its own.
const withoutPowershellDirs = () =>
  (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .filter((dir) => !/powershell/i.test(dir) && !existsSync(path.join(dir, "pwsh.exe")))
    .join(path.delimiter)

function withEnv(env: { PATH?: string; SHELL?: string }, fn: () => void) {
  const prevPath = process.env.PATH
  const prevShell = process.env.SHELL
  if (env.PATH === undefined) delete process.env.PATH
  else process.env.PATH = env.PATH
  if (env.SHELL === undefined) delete process.env.SHELL
  else process.env.SHELL = env.SHELL
  Shell.preferred.reset()
  Shell.acceptable.reset()
  try {
    fn()
  } finally {
    if (prevPath === undefined) delete process.env.PATH
    else process.env.PATH = prevPath
    if (prevShell === undefined) delete process.env.SHELL
    else process.env.SHELL = prevShell
    Shell.preferred.reset()
    Shell.acceptable.reset()
  }
}

if (process.platform === "win32") {
  describe("windows powershell selection", () => {
    test("prefers an installed powershell 7 when pwsh is absent from PATH", () => {
      if (!pwshInstalled()) return
      withEnv({ PATH: withoutPowershellDirs(), SHELL: undefined }, () => {
        expect(Shell.name(Shell.preferred())).toBe("pwsh")
        expect(Shell.name(Shell.acceptable())).toBe("pwsh")
      })
    })

    test("prefers pwsh over legacy 5.1 on the unmodified PATH", () => {
      if (!pwshInstalled()) return
      withEnv({ SHELL: undefined }, () => {
        expect(Shell.name(Shell.preferred())).toBe("pwsh")
      })
    })

    test("explicit shell config still overrides detection", () => {
      if (!existsSync(LEGACY)) return
      expect(Shell.preferred(LEGACY)).toBe(LEGACY)
      expect(Shell.acceptable(LEGACY)).toBe(LEGACY)
    })
  })
}
