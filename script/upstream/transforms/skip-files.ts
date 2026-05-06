#!/usr/bin/env bun
/**
 * Skip files transform - handles files that should be completely skipped during merge
 *
 * These are files that exist in upstream but should NOT exist in Kilo fork.
 * Examples: README.*.md (translated READMEs), STATS.md, etc.
 *
 * During merge, these files will be:
 * - Removed if they were added from upstream
 * - Kept deleted if they don't exist in Kilo
 */

import { $ } from "bun"
import { info, success, warn, debug } from "../utils/logger"
import { defaultConfig } from "../utils/config"
import { matches } from "../utils/match"

export interface SkipResult {
  file: string
  action: "removed" | "skipped" | "not-found"
  dryRun: boolean
}

export interface SkipOptions {
  dryRun?: boolean
  verbose?: boolean
  patterns?: string[]
  force?: boolean
  /**
   * Ref to treat as "the main repo we're merging into" when deciding whether
   * a removed file's parent directory is absent from the base. Defaults to
   * "HEAD", which is correct post-merge (HEAD = ours), but pre-merge on the
   * opencode branch the caller should pass the actual base branch.
   */
  baseRef?: string
}

/**
 * Check if a file matches any skip patterns
 */
export function shouldSkip(filePath: string, patterns: string[]): boolean {
  return matches(filePath, patterns)
}

/**
 * Get list of files that were added/modified from upstream during merge
 */
async function getUpstreamFiles(): Promise<string[]> {
  // Get files that are staged (after merge)
  const result = await $`git diff --cached --name-only`.quiet().nothrow()

  if (result.exitCode !== 0) return []

  return result.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((f) => f.length > 0)
}

/**
 * Get list of unmerged (conflicted) files
 */
async function getUnmergedFiles(): Promise<string[]> {
  const result = await $`git diff --name-only --diff-filter=U`.quiet().nothrow()

  if (result.exitCode !== 0) return []

  return result.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((f) => f.length > 0)
}

/**
 * Get tracked files from the current branch.
 */
async function getTrackedFiles(): Promise<string[]> {
  const result = await $`git ls-files`.quiet().nothrow()

  if (result.exitCode !== 0) return []

  return result.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((f) => f.length > 0)
}

/**
 * Check if a path (file or directory) exists in a specific git ref.
 * Works for trees too — `git cat-file -e <ref>:<path>` returns 0 for any
 * object the ref can resolve, including directory trees.
 */
async function pathExistsInRef(path: string, ref: string): Promise<boolean> {
  const result = await $`git cat-file -e ${ref}:${path}`.quiet().nothrow()
  return result.exitCode === 0
}

/**
 * Group successfully-removed files by their highest ancestor directory that
 * is missing from `baseRef`. Files whose every ancestor exists in the base
 * are returned as "singles" and logged individually.
 */
async function groupByMissingDir(
  files: string[],
  baseRef: string,
): Promise<{ dirs: Map<string, number>; singles: string[] }> {
  const cache = new Map<string, boolean>()
  async function exists(dir: string): Promise<boolean> {
    const hit = cache.get(dir)
    if (hit !== undefined) return hit
    const ok = await pathExistsInRef(dir, baseRef)
    cache.set(dir, ok)
    return ok
  }
  const dirs = new Map<string, number>()
  const singles: string[] = []
  for (const file of files) {
    const parts = file.split("/")
    let top: string | null = null
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/")
      if (!(await exists(dir))) {
        top = dir
        break
      }
    }
    if (top) dirs.set(top, (dirs.get(top) ?? 0) + 1)
    else singles.push(file)
  }
  return { dirs, singles }
}

function logRemovals(dirs: Map<string, number>, singles: string[], dryRun: boolean): void {
  const prefix = dryRun ? "[DRY-RUN] Would remove" : "Removed"
  const log = dryRun ? info : success
  for (const [dir, n] of dirs) {
    log(`${prefix} directory: ${dir} (${n} file${n === 1 ? "" : "s"})`)
  }
  for (const file of singles) {
    log(`${prefix}: ${file}`)
  }
}

/**
 * Remove a file from the merge (git rm). Retries once on failure since
 * transient index contention (editor watchers, rerere passes) has been
 * observed to make the first attempt fail sporadically.
 */
async function removeFile(file: string): Promise<{ ok: boolean; err?: string }> {
  const first = await $`git rm -f ${file}`.quiet().nothrow()
  if (first.exitCode === 0) return { ok: true }

  const retry = await $`git rm -f ${file}`.quiet().nothrow()
  if (retry.exitCode === 0) return { ok: true }

  const err = retry.stderr.toString().trim() || first.stderr.toString().trim()
  return { ok: false, err }
}

/**
 * Skip files that shouldn't exist in Kilo fork
 *
 * This function handles files that:
 * 1. Match skip patterns (like README.*.md)
 * 2. Were added from upstream during merge
 * 3. Don't exist in Kilo's version (HEAD before merge)
 */
export async function skipFiles(options: SkipOptions = {}): Promise<SkipResult[]> {
  const results: SkipResult[] = []
  const patterns = options.patterns || defaultConfig.skipFiles
  const baseRef = options.baseRef ?? "HEAD"
  const dryRun = options.dryRun ?? false

  if (!patterns || patterns.length === 0) {
    info("No skip patterns configured")
    return results
  }

  // Get all files involved in the merge
  const stagedFiles = await getUpstreamFiles()
  const unmergedFiles = await getUnmergedFiles()
  const tracked = options.force ? await getTrackedFiles() : []
  const allFiles = [...new Set([...stagedFiles, ...unmergedFiles, ...tracked])]

  if (allFiles.length === 0) {
    info("No files to process")
    return results
  }

  debug(`Checking ${allFiles.length} files against ${patterns.length} skip patterns`)

  // Phase 1: classify files (skip, toRemove).
  const toRemove: string[] = []
  for (const file of allFiles) {
    if (!shouldSkip(file, patterns)) continue

    // Check if file existed in Kilo before merge. In force mode we don't gate
    // on existence — the caller wants all tracked matches gone.
    const existedInKilo = options.force ? false : await pathExistsInRef(file, baseRef)

    if (existedInKilo) {
      debug(`Skipping ${file} - exists in base ref, not removing`)
      results.push({ file, action: "skipped", dryRun })
      continue
    }

    toRemove.push(file)
  }

  // Phase 2: perform removals, tracking which actually succeeded so we can
  // batch log only real removals (failures get an immediate warn).
  const removed: string[] = []
  for (const file of toRemove) {
    if (dryRun) {
      removed.push(file)
      results.push({ file, action: "removed", dryRun: true })
      continue
    }
    const res = await removeFile(file)
    if (res.ok) {
      removed.push(file)
      results.push({ file, action: "removed", dryRun: false })
    } else {
      warn(`Failed to remove ${file}: ${res.err ?? "unknown error"}`)
      results.push({ file, action: "not-found", dryRun: false })
    }
  }

  // Phase 3: fold per-file log lines into a single "Removed directory: X"
  // line whenever every removed file's top-level directory is absent from
  // the base ref. Removes a huge chunk of noise when entire directories
  // (packages/web, packages/console, …) don't exist in Kilo.
  const { dirs, singles } = await groupByMissingDir(removed, baseRef)
  logRemovals(dirs, singles, dryRun)

  return results
}

/**
 * Skip files from a specific list (used during conflict resolution)
 */
export async function skipSpecificFiles(files: string[], options: SkipOptions = {}): Promise<SkipResult[]> {
  const results: SkipResult[] = []

  for (const file of files) {
    if (options.dryRun) {
      info(`[DRY-RUN] Would remove: ${file}`)
      results.push({ file, action: "removed", dryRun: true })
    } else {
      const res = await removeFile(file)
      if (res.ok) {
        success(`Removed: ${file}`)
        results.push({ file, action: "removed", dryRun: false })
      } else {
        warn(`Failed to remove ${file}: ${res.err ?? "unknown error"}`)
        results.push({ file, action: "not-found", dryRun: false })
      }
    }
  }

  return results
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const verbose = args.includes("--verbose")

  // Get specific files if provided
  const files = args.filter((a) => !a.startsWith("--"))

  if (dryRun) {
    info("Running in dry-run mode (no files will be modified)")
  }

  const results =
    files.length > 0 ? await skipSpecificFiles(files, { dryRun, verbose }) : await skipFiles({ dryRun, verbose })

  const removed = results.filter((r) => r.action === "removed")
  console.log()
  success(`Removed ${removed.length} files`)

  if (dryRun) {
    info("Run without --dry-run to apply changes")
  }
}
