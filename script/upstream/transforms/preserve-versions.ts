#!/usr/bin/env bun
/**
 * Preserve Kilo package versions during upstream merge
 *
 * This script ensures that Kilo's package versions are not overwritten
 * by upstream versions during merge.
 */

import { Glob } from "bun"
import { info, success, warn, debug } from "../utils/logger"
import { defaultConfig } from "../utils/config"

export interface VersionPreserveResult {
  file: string
  originalVersion: string
  preserved: boolean
  dryRun: boolean
}

export interface PreserveOptions {
  dryRun?: boolean
  verbose?: boolean
  targetVersion?: string
}

/**
 * Get the current Kilo version from the main package.json
 */
export async function getCurrentVersion(): Promise<string> {
  const pkg = await Bun.file("packages/opencode/package.json").json()
  return pkg.version
}

/**
 * Preserve version in a single package.json file
 */
export async function preserveVersion(filePath: string, options: PreserveOptions = {}): Promise<VersionPreserveResult> {
  const file = Bun.file(filePath)
  const content = await file.text()

  // Extract current version
  const versionMatch = content.match(/"version":\s*"([^"]+)"/)
  const originalVersion = versionMatch ? versionMatch[1] : "unknown"

  const targetVersion = options.targetVersion || (await getCurrentVersion())

  // Replace version with target version
  const newContent = content.replace(/"version":\s*"[^"]+"/, `"version": "${targetVersion}"`)

  const changed = newContent !== content

  if (changed && !options.dryRun) {
    await Bun.write(filePath, newContent)
  }

  return {
    file: filePath,
    originalVersion: originalVersion ?? "unknown",
    preserved: changed,
    dryRun: options.dryRun ?? false,
  }
}

export async function preserveZedVersion(
  filePath: string,
  options: PreserveOptions = {},
): Promise<VersionPreserveResult> {
  const file = Bun.file(filePath)
  const content = await file.text()
  const versionMatch = content.match(/^version = "([^"]+)"/m)
  const originalVersion = versionMatch ? versionMatch[1] : "unknown"
  const targetVersion = options.targetVersion || (await getCurrentVersion())
  const next = content
    .replace(/^version = "[^"]+"/m, `version = "${targetVersion}"`)
    .replace(/\/releases\/download\/v[^/]+\//g, `/releases/download/v${targetVersion}/`)
  const changed = next !== content

  if (changed && !options.dryRun) await Bun.write(filePath, next)

  return {
    file: filePath,
    originalVersion,
    preserved: changed,
    dryRun: options.dryRun ?? false,
  }
}

/**
 * Preserve versions in all package.json files
 */
export async function preserveAllVersions(options: PreserveOptions = {}): Promise<VersionPreserveResult[]> {
  const results: VersionPreserveResult[] = []

  const glob = new Glob("**/package.json")

  const excludes = defaultConfig.excludePatterns

  const targetVersion = options.targetVersion || (await getCurrentVersion())

  info(`Target version: ${targetVersion}`)

  const track = (result: VersionPreserveResult) => {
    if (!result.preserved) return
    results.push(result)
    if (options.dryRun) {
      info(`[DRY-RUN] Would preserve ${result.file}: ${result.originalVersion} -> ${targetVersion}`)
      return
    }
    success(`Preserved ${result.file}: ${result.originalVersion} -> ${targetVersion}`)
  }

  for await (const path of glob.scan({ absolute: true })) {
    // Skip excluded paths
    if (excludes.some((ex) => path.includes(ex.replace(/\*\*/g, "")))) {
      continue
    }

    track(await preserveVersion(path, { ...options, targetVersion }))
  }

  const zed = "packages/extensions/zed/extension.toml"
  if (await Bun.file(zed).exists()) track(await preserveZedVersion(zed, { ...options, targetVersion }))

  return results
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const verbose = args.includes("--verbose")

  // Check for --version flag
  const versionIdx = args.indexOf("--version")
  const targetVersion = versionIdx !== -1 ? args[versionIdx + 1] : undefined

  if (dryRun) {
    info("Running in dry-run mode (no files will be modified)")
  }

  const results = await preserveAllVersions({ dryRun, verbose, targetVersion })

  console.log()
  success(`Preserved versions in ${results.length} files`)

  if (dryRun) {
    info("Run without --dry-run to apply changes")
  }
}
