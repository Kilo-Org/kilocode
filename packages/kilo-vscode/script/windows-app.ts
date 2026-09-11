import { existsSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

export function isWindowsBatchFile(app: string): boolean {
  return /\.(cmd|bat)$/i.test(app)
}

/** PATH lookup order on Windows: GUI exe first so `bin\code.cmd` is not preferred. */
export function windowsPathExtensions(): string[] {
  return [".exe", ".cmd", ".bat", ""]
}

/**
 * VS Code's PATH entry is often `...\Microsoft VS Code\bin\code.cmd`.
 * The GUI host is the sibling `Code.exe`. Prefer that so spawn() does not need cmd.exe.
 */
export function preferWindowsGuiExecutable(app: string): string {
  if (!isWindowsBatchFile(app)) return app
  const dir = dirname(app)
  const insiders = basename(app).toLowerCase().includes("insiders")
  const exeName = insiders ? "Code - Insiders.exe" : "Code.exe"
  const nextToBin = resolve(dir, "..", exeName)
  if (existsSync(nextToBin)) return nextToBin
  const sameDir = join(dir, exeName)
  if (existsSync(sameDir)) return sameDir
  return app
}

/** cmd.exe is required to run leftover .cmd/.bat; it must not wrap Code.exe paths with spaces. */
export function spawnNeedsWindowsShell(app: string): boolean {
  return isWindowsBatchFile(app)
}
