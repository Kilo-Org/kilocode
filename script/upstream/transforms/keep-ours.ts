#!/usr/bin/env bun
/**
 * Keep Kilo's version of specific files during merge
 *
 * This script handles files that should always keep Kilo's version
 * and not be overwritten by upstream changes.
 */

import { $ } from "bun"
import { info, success, warn, error, debug } from "../utils/logger"
import { defaultConfig } from "../utils/config"
import { checkoutOurs, stageFiles, getConflictedFiles } from "../utils/git"
import { matches } from "../utils/match"

export interface KeepOursResult {
  file: string
  action: "kept" | "skipped" | "not-conflicted"
  dryRun: boolean
}

export interface KeepOursOptions {
  dryRun?: boolean
  verbose?: boolean
  files?: string[]
}

/**
 * Check if a file matches any keep-ours patterns
 */
export function shouldKeepOurs(filePath: string, patterns: string[]): boolean {
  const dirs = defaultConfig.kiloDirectories.map((dir) => `${dir}/**`)
  return matches(filePath, [...patterns, ...dirs]) || patterns.some((pattern) => filePath.includes(pattern))
}

/**
 * Keep Kilo's version of conflicted files
 */
export async function keepOursFiles(options: KeepOursOptions = {}): Promise<KeepOursResult[]> {
  const results: KeepOursResult[] = []

  // Get list of conflicted files
  const conflicted = await getConflictedFiles()

  if (conflicted.length === 0) {
    info("No conflicted files found")
    return results
  }

  info(`Found ${conflicted.length} conflicted files`)

  const patterns = options.files || defaultConfig.keepOurs

  for (const file of conflicted) {
    if (shouldKeepOurs(file, patterns)) {
      if (options.dryRun) {
        info(`[DRY-RUN] Would keep ours: ${file}`)
        results.push({ file, action: "kept", dryRun: true })
      } else {
        try {
          await checkoutOurs([file])
          await stageFiles([file])
          success(`Kept ours: ${file}`)
          results.push({ file, action: "kept", dryRun: false })
        } catch (err) {
          error(`Failed to keep ours for ${file}: ${err}`)
          results.push({ file, action: "skipped", dryRun: false })
        }
      }
    } else {
      debug(`Skipping ${file} (not in keep-ours list)`)
      results.push({ file, action: "not-conflicted", dryRun: options.dryRun ?? false })
    }
  }

  return results
}

/**
 * Reset specific files to Kilo's version (even if not conflicted)
 */
export async function resetToOurs(files: string[], options: KeepOursOptions = {}): Promise<KeepOursResult[]> {
  const results: KeepOursResult[] = []

  for (const file of files) {
    if (options.dryRun) {
      info(`[DRY-RUN] Would reset to ours: ${file}`)
      results.push({ file, action: "kept", dryRun: true })
    } else {
      try {
        // Get the file from HEAD (Kilo's version)
        await $`git checkout HEAD -- ${file}`
        success(`Reset to ours: ${file}`)
        results.push({ file, action: "kept", dryRun: false })
      } catch (err) {
        warn(`Could not reset ${file}: ${err}`)
        results.push({ file, action: "skipped", dryRun: false })
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
    files.length > 0 ? await resetToOurs(files, { dryRun, verbose }) : await keepOursFiles({ dryRun, verbose })

  const kept = results.filter((r) => r.action === "kept")
  console.log()
  success(`Kept Kilo's version for ${kept.length} files`)

  if (dryRun) {
    info("Run without --dry-run to apply changes")
  }
}
