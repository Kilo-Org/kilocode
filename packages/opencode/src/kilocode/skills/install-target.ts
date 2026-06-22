// kilocode_change - new file
// Pure path/id resolvers for skill install/remove. Kept separate so they
// can be unit-tested without an Effect runtime, mirroring skill-remove.ts.

import * as path from "path"
import os from "os"
import { Global } from "@opencode-ai/core/global"

export type Scope = "global" | "project"

/**
 * Skill install directory for a given scope.
 * - global: ~/.kilo/skills (matches KilocodePaths.globalDirs and the
 *   VS Code MarketplacePaths.skillsDir default)
 * - project: <workspace>/.kilo/skills
 */
export function skillsDir(scope: Scope, workspace?: string): string {
  if (scope === "project") {
    if (!workspace) throw new Error("workspace directory is required for project-scope install")
    return path.join(workspace, ".kilo", "skills")
  }
  return path.join(Global.Path.home, ".kilo", "skills")
}

/**
 * Validate a skill id is safe to use as a directory name. Rejects path
 * traversal, Windows reserved names, and characters outside the allowed set.
 * Mirrors MarketplaceInstaller.isSafeId in the VS Code extension.
 */
export function isSafeId(id: string): boolean {
  if (!id || id === "." || id.includes("..") || id.includes("/") || id.includes("\\") || id.endsWith(".")) return false
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(id)) return false
  return /^[\w\-@.]+$/.test(id)
}

/** Resolve the final skill directory and confirm it stays inside base. */
export function resolveTarget(base: string, id: string): string {
  if (!isSafeId(id)) throw new Error(`invalid skill id: ${id}`)
  const dir = path.join(base, id)
  if (!contains(base, dir)) throw new Error(`invalid skill id: ${id}`)
  return dir
}

/** True if `filepath` is inside `dir` (prevents path escape from the base). */
export function contains(dir: string, filepath: string): boolean {
  return path.resolve(filepath).startsWith(path.resolve(dir) + path.sep)
}

/** The cache directory used for URL-pulled skills (protected from remove). */
export function cacheDir(): string {
  return path.join(Global.Path.cache, "skills")
}

/** Walk a directory tree and return any paths that escape `root` (incl. symlinks). */
export async function findEscapedPaths(root: string): Promise<string[]> {
  const fs = await import("fs/promises")
  const resolved = path.resolve(root)
  const escaped: string[] = []

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.resolve(current, entry.name)
      if (!full.startsWith(resolved + path.sep) && full !== resolved) {
        escaped.push(full)
        continue
      }
      if (entry.isSymbolicLink()) {
        const target = await fs.realpath(full)
        if (!target.startsWith(resolved + path.sep) && target !== resolved) {
          escaped.push(full)
          continue
        }
      }
      if (entry.isDirectory()) await walk(full)
    }
  }

  await walk(root)
  return escaped
}

export { os }
