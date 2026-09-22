import path from "path"
import { Global } from "@opencode-ai/core/global"
import { KilocodeConfigOverlay } from "@/kilocode/config/overlay"
import type { Scope } from "./schema"

export async function configPath(scope: Scope, directory: string, worktree?: string) {
  if (scope === "global") return KilocodeConfigOverlay.globalTarget()
  return KilocodeConfigOverlay.projectTarget({ directory, worktree })
}

export function pluginFiles(scope: Scope, directory: string, worktree?: string) {
  const names = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "tui.jsonc", "tui.json"]
  if (scope === "global") return [...names, "config.json"].map((name) => path.join(Global.Path.config, name))

  const dir = path.resolve(directory)
  const target = worktree ? path.resolve(worktree) : dir
  const relative = path.relative(target, dir)
  // Non-git projects use the filesystem root as a sentinel, not a scope boundary.
  const root =
    target !== path.parse(target).root && !path.isAbsolute(relative) && relative.split(path.sep).at(0) !== ".."
      ? target
      : dir
  const dirs: string[] = []
  let current = dir
  while (true) {
    dirs.push(current, path.join(current, ".kilo"), path.join(current, ".kilocode"))
    const parent = path.dirname(current)
    if (current === root || parent === current) break
    current = parent
  }
  // Enumerate candidates without an exists check: unreadable configs must not
  // disappear from removal's result. A missing file is handled by the reader.
  return [...new Set(dirs.flatMap((dir) => names.map((name) => path.join(dir, name))))]
}

export function agentsDir(scope: Scope, directory: string) {
  if (scope === "global") return path.join(Global.Path.config, "agents")
  return path.join(directory, ".kilo", "agents")
}

export function skillsDir(scope: Scope, directory: string) {
  if (scope === "global") return path.join(Global.Path.home, ".kilo", "skills")
  return path.join(directory, ".kilo", "skills")
}

export function configRoot(scope: Scope, directory: string) {
  if (scope === "global") return Global.Path.config
  return path.join(directory, ".kilo")
}
