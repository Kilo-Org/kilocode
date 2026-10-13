#!/usr/bin/env bun
/**
 * Preserve Kilo package versions during upstream merge.
 *
 * On the v2 line Kilo follows upstream version numbers, so this transform is off unless
 * `transforms.versions` is on or a caller passes `--force`. The version source is the root
 * `package.json`.
 */

import { Glob } from "bun"
import { info, success } from "../utils/logger"
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
  force?: boolean
}

/**
 * Get the current Kilo version from the root package.json.
 */
export async function getCurrentVersion(): Promise<string> {
  const path = new URL("../../../package.json", import.meta.url).pathname
  const pkg = await Bun.file(path).json()
  return pkg.version
}

/**
 * Preserve version in a single package.json file.
 */
export async function preserveVersion(filePath: string, options: PreserveOptions = {}): Promise<VersionPreserveResult> {
  const file = Bun.file(filePath)
  const content = await file.text()

  const versionMatch = content.match(/"version":\s*"([^"]+)"/)
  const originalVersion = versionMatch ? versionMatch[1] : "unknown"

  const targetVersion = options.targetVersion || (await getCurrentVersion())
  const newContent = content.replace(/"version":\s*"[^"]+"/, `"version": "${targetVersion}"`)
  const changed = newContent !== content

  if (changed && !options.dryRun) await Bun.write(filePath, newContent)

  return {
    file: filePath,
    originalVersion: originalVersion ?? "unknown",
    preserved: changed,
    dryRun: options.dryRun ?? false,
  }
}

/**
 * Preserve versions in all package.json files.
 */
export async function preserveAllVersions(options: PreserveOptions = {}): Promise<VersionPreserveResult[]> {
  if (!defaultConfig.transforms.versions && !options.force) {
    info("Version preservation is off in the v2 config (transforms.versions); pass --force to run it")
    return []
  }

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
    if (excludes.some((ex) => path.includes(ex.replace(/\*\*/g, "")))) continue
    track(await preserveVersion(path, { ...options, targetVersion }))
  }

  return results
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const verbose = args.includes("--verbose")
  const force = args.includes("--force")

  const versionIdx = args.indexOf("--version")
  const targetVersion = versionIdx !== -1 ? args[versionIdx + 1] : undefined

  if (dryRun) info("Running in dry-run mode (no files will be modified)")

  const results = await preserveAllVersions({ dryRun, verbose, targetVersion, force })

  console.log()
  if (results.length === 0 && !defaultConfig.transforms.versions && !force) {
    info("No versions preserved")
  } else {
    success(`Preserved versions in ${results.length} files`)
  }

  if (dryRun) info("Run without --dry-run to apply changes")
}
