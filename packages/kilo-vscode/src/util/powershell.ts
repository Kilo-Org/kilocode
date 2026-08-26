import { statSync } from "node:fs"
import * as path from "node:path"

/**
 * Well-known PowerShell 7 install locations on Windows. The Store install only
 * exposes `pwsh.exe` through the WindowsApps execution alias, which is often
 * missing from the PATH of spawned child processes.
 */
export function locations(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [
    env["ProgramFiles"] && path.join(env["ProgramFiles"], "PowerShell", "7"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "PowerShell", "7"),
    env["LOCALAPPDATA"] && path.join(env["LOCALAPPDATA"], "Microsoft", "WindowsApps"),
  ].filter((item): item is string => Boolean(item))
  return roots.map((root) => path.join(root, "pwsh.exe"))
}

function exists(file: string): boolean {
  return statSync(file, { throwIfNoEntry: false })?.isFile() === true
}

export function pwshPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dirs = [...(env.PATH ?? env.Path ?? "").split(path.delimiter), ...locations(env)]
  return dirs
    .filter(Boolean)
    .map((dir) => path.join(dir, "pwsh.exe"))
    .find(exists)
}

/** Prefer PowerShell 7; legacy 5.1 writes UTF-16LE BOM output on redirection. */
export function powershellCommand(env: NodeJS.ProcessEnv = process.env): string {
  return pwshPath(env) ?? "powershell.exe"
}
