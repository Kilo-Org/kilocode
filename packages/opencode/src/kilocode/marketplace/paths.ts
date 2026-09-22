import path from "path"
import { realpathSync, statSync } from "fs"
import { Global } from "@opencode-ai/core/global"
import { KilocodeConfigOverlay } from "@/kilocode/config/overlay"
import type { Scope } from "./schema"

export async function configPath(scope: Scope, directory: string, worktree?: string) {
  if (scope === "global") return KilocodeConfigOverlay.globalTarget()
  return KilocodeConfigOverlay.projectTarget({ directory, worktree })
}

function canonical(dir: string) {
  try {
    return realpathSync.native(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return path.resolve(dir)
    throw err
  }
}

export function pluginFiles(scope: Scope, directory: string, worktree?: string) {
  const names = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "tui.jsonc", "tui.json"]
  if (scope === "global") return [...names, "config.json"].map((name) => path.join(Global.Path.config, name))

  const dir = canonical(directory)
  const target = worktree ? canonical(worktree) : dir
  const relative = path.relative(target, dir)
  const depth = (() => {
    // Non-git projects use the filesystem root as a sentinel, not a scope boundary.
    if (target === path.parse(target).root) return 0
    if (!path.isAbsolute(relative) && relative.split(path.sep).at(0) !== "..") {
      return relative.split(path.sep).filter(Boolean).length
    }
    // realpath need not normalize case. On case-insensitive POSIX filesystems,
    // prove ancestry by directory identity instead of lowercasing distinct paths.
    const ancestor = statSync(target, { throwIfNoEntry: false })
    if (!ancestor?.isDirectory()) return 0
    let current = dir
    for (let step = 0; path.dirname(current) !== current; step++) {
      const entry = statSync(current, { throwIfNoEntry: false })
      if (entry?.isDirectory() && entry.dev === ancestor.dev && entry.ino === ancestor.ino) return step
      current = path.dirname(current)
    }
    return 0
  })()
  const dirs: string[] = []
  let current = dir
  // Count validated parent steps instead of comparing raw paths. Windows path
  // comparisons can accept an ancestor whose spelling differs only in case.
  for (let step = 0; step <= depth; step++) {
    dirs.push(current, path.join(current, ".kilo"), path.join(current, ".kilocode"))
    current = path.dirname(current)
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
