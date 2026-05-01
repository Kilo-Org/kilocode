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
 * Check if a file exists in a specific git ref
 */
async function fileExistsInRef(file: string, ref: string): Promise<boolean> {
  const result = await $`git cat-file -e ${ref}:${file}`.quiet().nothrow()
  return result.exitCode === 0
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

  for (const file of allFiles) {
    if (!shouldSkip(file, patterns)) continue

    // Check if file existed in Kilo before merge (HEAD~1 or the merge base)
    const existedInKilo = options.force ? false : await fileExistsInRef(file, "HEAD")

    if (existedInKilo) {
      debug(`Skipping ${file} - exists in Kilo, not removing`)
      results.push({ file, action: "skipped", dryRun: options.dryRun ?? false })
      continue
    }

    // File doesn't exist in Kilo - should be removed
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
