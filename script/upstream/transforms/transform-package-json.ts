#!/usr/bin/env bun
/**
 * Enhanced package.json transform for the Kilo v2 line.
 *
 * This script handles package.json conflicts by:
 * 1. Taking upstream's version (to get new dependencies)
 * 2. Transforming package names when `transforms.packageNames` is on
 * 3. Merging dependencies with a "newest wins" strategy
 * 4. Keeping Kilo metadata and workspace packages only when Kilo changed them from the merge base
 * 5. Preserving Kilo's version number only when `transforms.versions` is on
 */

import { $ } from "bun"
import { info, success, warn, debug } from "../utils/logger"
import { getCurrentVersion } from "./preserve-versions"
import { oursHasKilocodeChanges } from "../utils/git"
import { defaultConfig } from "../utils/config"

/**
 * Extract clean version string from a version specifier
 * Removes ^, ~, >=, etc. prefixes
 */
function extractVersion(version: string): string | null {
  // Handle special formats that can't be compared
  if (
    version.startsWith("workspace:") ||
    version.startsWith("catalog:") ||
    version.startsWith("http://") ||
    version.startsWith("https://") ||
    version.startsWith("git://") ||
    version.startsWith("git+") ||
    version.startsWith("file:") ||
    version.startsWith("link:") ||
    version.startsWith("npm:")
  ) {
    return null
  }

  // Remove common prefixes: ^, ~, >=, >, <=, <, =
  const cleaned = version.replace(/^[\^~>=<]+/, "").trim()

  // Basic semver validation (x.y.z with optional pre-release/build)
  if (/^\d+\.\d+\.\d+/.test(cleaned)) {
    return cleaned
  }

  // Handle x.y format
  if (/^\d+\.\d+$/.test(cleaned)) {
    return cleaned + ".0"
  }

  // Handle single number
  if (/^\d+$/.test(cleaned)) {
    return cleaned + ".0.0"
  }

  return null
}

/**
 * Parse a semver string into components
 */
function parseSemver(version: string): { major: number; minor: number; patch: number; prerelease: string } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?/)
  if (!match) return null

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || "",
  }
}

/**
 * Compare two version strings
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 * For special formats (URLs, catalog:, workspace:*), returns null (can't compare)
 */
function compareVersions(a: string, b: string): number | null {
  const cleanA = extractVersion(a)
  const cleanB = extractVersion(b)

  // If either can't be parsed, return null (can't compare)
  if (!cleanA || !cleanB) return null

  const semverA = parseSemver(cleanA)
  const semverB = parseSemver(cleanB)

  if (!semverA || !semverB) return null

  // Compare major.minor.patch
  if (semverA.major !== semverB.major) return semverA.major > semverB.major ? 1 : -1
  if (semverA.minor !== semverB.minor) return semverA.minor > semverB.minor ? 1 : -1
  if (semverA.patch !== semverB.patch) return semverA.patch > semverB.patch ? 1 : -1

  // Handle prerelease (no prerelease > prerelease)
  if (!semverA.prerelease && semverB.prerelease) return 1
  if (semverA.prerelease && !semverB.prerelease) return -1
  if (semverA.prerelease && semverB.prerelease) {
    return semverA.prerelease.localeCompare(semverB.prerelease)
  }

  return 0
}

function bun(value: unknown): { value: string; version: string } | null {
  if (typeof value !== "string") return null
  const match = value.match(/^bun@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/)
  if (!match) return null
  return { value, version: match[1] }
}

export function selectBunPackageManager(ours: unknown, theirs: unknown): string | undefined {
  const left = bun(ours)
  const right = bun(theirs)
  if (left && right) return compareVersions(left.version, right.version)! >= 0 ? left.value : right.value
  if (left) return left.value
  if (right) return right.value
  return undefined
}

export function fixPackageManager(
  pkg: Record<string, unknown>,
  path: string,
  ours: Record<string, unknown> | null,
  changes: string[],
): void {
  if (path !== "package.json") return
  const next = selectBunPackageManager(ours?.packageManager, pkg.packageManager)
  if (!next || pkg.packageManager === next) return
  const prior = typeof pkg.packageManager === "string" ? pkg.packageManager : "missing or invalid"
  changes.push(`packageManager: ${prior} -> ${next} (preserved Kilo pin)`)
  pkg.packageManager = next
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** True when our side changed the value from the merge base (or the base is unknown). */
function differs(ours: unknown, base: unknown): boolean {
  if (ours === undefined) return false
  if (base === undefined) return true
  return !same(ours, base)
}

/**
 * Keep Kilo's repository metadata only when Kilo changed it from the merge base. When our side
 * equals the base, take upstream's value. A null base (pre-merge, base unknown) keeps ours.
 */
export function fixRepository(
  pkg: Record<string, unknown>,
  ours: Record<string, unknown> | null,
  base: Record<string, unknown> | null,
  changes: string[],
): void {
  if (!ours) return
  for (const key of ["repository", "homepage", "bugs"] as const) {
    if (ours[key] === undefined) continue
    if (base && !differs(ours[key], base[key])) continue
    if (same(pkg[key], ours[key])) continue
    pkg[key] = ours[key]
    changes.push(`${key}: preserved Kilo metadata`)
  }
}

/**
 * Keep Kilo's root `workspaces.packages` only when Kilo changed it from the merge base.
 */
export function preserveWorkspacePackages(
  pkg: Record<string, unknown>,
  ours: Record<string, unknown> | null,
  base: Record<string, unknown> | null,
  relativePath: string,
  changes: string[],
): void {
  if (relativePath !== "package.json" || !ours) return
  const ourPackages = (ours.workspaces as { packages?: string[] } | undefined)?.packages
  if (!ourPackages) return
  const basePackages = (base?.workspaces as { packages?: string[] } | undefined)?.packages
  if (base && !differs(ourPackages, basePackages)) return
  const workspaces = (pkg.workspaces as Record<string, unknown> | undefined) || {}
  if (same(workspaces.packages, ourPackages)) return
  workspaces.packages = ourPackages
  pkg.workspaces = workspaces
  changes.push("workspaces.packages: preserved Kilo's workspace configuration")
}

export function assertBunPackageManager(current: unknown, base: unknown, upstream: unknown): void {
  const inputs = [bun(base), bun(upstream)].filter((item): item is NonNullable<typeof item> => item !== null)
  if (inputs.length === 0) return
  const required = inputs.reduce((max, item) => (compareVersions(item.version, max.version)! > 0 ? item : max))
  const actual = bun(current)
  if (!actual) {
    throw new Error(
      `Bun packageManager validation failed: merged value is invalid; expected at least ${required.value}`,
    )
  }
  if (compareVersions(actual.version, required.version)! >= 0) return
  throw new Error(`Bun packageManager downgrade detected: merged ${actual.value}, expected at least ${required.value}`)
}

/**
 * Merge two dependency objects using "newest wins" strategy
 * For non-comparable versions (URLs, catalog:, workspace:*), upstream (theirs) wins
 *
 * Key order preserves ours' order first (so kilo-only deps stay in their
 * original position), then appends theirs-only keys at the end. This avoids
 * relocating existing keys, which would otherwise let git's textual merge
 * produce duplicate JSON keys (ours keeps the line in place, theirs appears
 * to "add" the same key elsewhere → both survive the merge).
 */
export function mergeWithNewestVersions(
  ours: Record<string, string> | undefined,
  theirs: Record<string, string> | undefined,
  changes: string[],
  section: string,
  base?: Record<string, string>,
): Record<string, string> | undefined {
  if (!ours && !theirs) return
  const result: Record<string, string> = {}

  // Seed with ours' keys in ours' order, applying newest-wins per key.
  if (ours) {
    for (const [name, ourVersion] of Object.entries(ours)) {
      const theirVersion = theirs?.[name]
      // Three-way rule with the merge base: a value Kilo did not change follows upstream, including an
      // upstream removal or downgrade; a value upstream did not change keeps Kilo's.
      if (base && same(ourVersion, base[name])) {
        if (theirVersion !== undefined) result[name] = theirVersion
        if (theirVersion === undefined) changes.push(`${section}: ${name} removed upstream`)
        continue
      }
      if (base && same(theirVersion, base[name])) {
        result[name] = ourVersion
        if (theirVersion !== ourVersion) changes.push(`${section}: ${name} kept Kilo ${ourVersion}`)
        continue
      }
      if (theirVersion === undefined) {
        result[name] = ourVersion
        changes.push(`${section}: preserved ${name}@${ourVersion} (kilo-only)`)
        continue
      }
      if (ourVersion === theirVersion) {
        result[name] = theirVersion
        continue
      }
      // Object values (nested overrides) cannot be compared as versions: take upstream's.
      if (typeof ourVersion !== "string" || typeof theirVersion !== "string") {
        result[name] = theirVersion
        changes.push(`${section}: ${name} kept upstream (not a version string)`)
        continue
      }
      const cmp = compareVersions(ourVersion, theirVersion)
      if (cmp === null) {
        result[name] = theirVersion
        changes.push(`${section}: ${name} kept upstream ${theirVersion} (special format)`)
      } else if (cmp > 0) {
        result[name] = ourVersion
        changes.push(`${section}: ${name} ${theirVersion} -> ${ourVersion} (kilo newer)`)
      } else {
        result[name] = theirVersion
        if (cmp < 0) changes.push(`${section}: ${name} kept upstream ${theirVersion} (upstream newer)`)
      }
    }
  }

  // Append any theirs-only keys at the end, preserving theirs' relative order.
  if (theirs) {
    for (const [name, version] of Object.entries(theirs)) {
      if (result[name] !== undefined) continue
      // Kilo removed a key that upstream did not change: keep it removed.
      if (base && ours && !(name in ours) && same(version, base[name])) continue
      result[name] = version
    }
  }

  return result
}

export interface PackageJsonResult {
  file: string
  action: "transformed" | "skipped" | "failed" | "flagged"
  changes: string[]
  dryRun: boolean
}

export interface PackageJsonOptions {
  dryRun?: boolean
  verbose?: boolean
  preserveVersion?: boolean
}

export interface ReconcileOptions extends PackageJsonOptions {
  oursRef: string
  theirsRef: string
  /** Merge base ref for the three-way metadata rule. Defaults to the merge base of the two refs. */
  baseRef?: string
  /**
   * Files to skip (e.g. still-conflicted files where the user is going to
   * resolve manually). The reconciler would otherwise overwrite the conflict
   * markers and silently auto-resolve.
   */
  skip?: Set<string>
}

/** Versions are preserved only when the switch is on or a caller asks for it explicitly. */
function shouldPreserveVersion(options: PackageJsonOptions): boolean {
  return options.preserveVersion === true || defaultConfig.transforms.versions
}

// Package name mappings, built from the configured mappings and applied only when
// `transforms.packageNames` is on. On the v2 line Kilo keeps upstream `@opencode/*` names by default.
const PACKAGE_NAME_MAP: Record<string, string> = defaultConfig.transforms.packageNames
  ? Object.fromEntries(defaultConfig.packageMappings.map((mapping) => [mapping.from, mapping.to]))
  : {}

// Kilo-specific dependencies to inject into specific packages. Empty on v2.
const KILO_DEPENDENCIES: Record<string, Record<string, string>> = {}

// Kilo-specific bin entries to set on specific packages. Empty on v2.
const KILO_BIN: Record<string, Record<string, string>> = {}

// Packages that should have their name transformed. Empty on v2.
const TRANSFORM_PACKAGE_NAMES: Record<string, string> = {}

// Kilo-specific scripts to preserve from the base branch per package.json. Kilo's root `dev`
// runs `bun script/dev-isolated.ts`, which upstream does not have.
const PRESERVE_SCRIPTS: Record<string, string[]> = {
  "package.json": ["dev"],
}

// Upstream-only trusted dependencies to delete per package.json. Empty on v2.
const DELETE_UPSTREAM_TRUSTED_DEPS: Record<string, string[]> = {}

// Upstream-only scripts to delete per package.json. Empty on v2.
const DELETE_UPSTREAM_SCRIPTS: Record<string, string[]> = {}

// Upstream-only catalog entries to delete per package.json. Empty on v2.
const DELETE_UPSTREAM_CATALOG: Record<string, string[]> = {}

const DELETE_UPSTREAM_DEPENDENCIES = new Set<string>()

/**
 * Re-apply Kilo-specific scripts on top of the upstream-shaped scripts block,
 * and prune upstream-only scripts that target packages Kilo doesn't ship.
 */
export function fixScripts(
  pkg: Record<string, unknown>,
  path: string,
  ours: Record<string, unknown> | null,
  changes: string[],
): void {
  const theirs = (pkg.scripts as Record<string, string> | undefined) || {}
  const oursScripts = (ours?.scripts as Record<string, string> | undefined) || {}

  for (const name of PRESERVE_SCRIPTS[path] || []) {
    const val = oursScripts[name]
    if (val && theirs[name] !== val) {
      theirs[name] = val
      changes.push(`scripts.${name}: preserved from base`)
    }
  }

  for (const name of DELETE_UPSTREAM_SCRIPTS[path] || []) {
    if (theirs[name]) {
      delete theirs[name]
      changes.push(`scripts.${name}: removed (upstream-only, no Kilo target)`)
    }
  }

  if (Object.keys(theirs).length > 0) pkg.scripts = theirs
}

/**
 * Prune upstream-only trusted dependencies whose native lifecycle builds
 * conflict with Kilo's install policy.
 */
export function fixTrustedDependencies(pkg: Record<string, unknown>, path: string, changes: string[]): void {
  const trusted = pkg.trustedDependencies as string[] | undefined
  if (!trusted) return
  for (const name of DELETE_UPSTREAM_TRUSTED_DEPS[path] || []) {
    const index = trusted.indexOf(name)
    if (index !== -1) {
      trusted.splice(index, 1)
      changes.push(`trustedDependencies: removed ${name} (native build conflicts with Kilo install policy)`)
    }
  }
}

/**
 * Drop upstream patchedDependencies entries that conflict with Kilo's pins or
 * whose patch file did not come over. Kilo pins newer patched versions of some
 * packages (e.g. fff-bun, pacote, xai), and stale upstream entries for the
 * same package, or entries with a missing patch file, break bun install.
 */
export async function prunePatchedDependencies(
  pkg: Record<string, unknown>,
  ours: Record<string, unknown> | null,
  changes: string[],
): Promise<void> {
  const patched = pkg.patchedDependencies as Record<string, string> | undefined
  const ourPatched = (ours?.patchedDependencies as Record<string, string> | undefined) || {}
  if (!patched || Object.keys(ourPatched).length === 0) return
  const ourPackages = new Set(Object.keys(ourPatched).map((key) => key.replace(/@[^@]+$/, "")))
  for (const [key, patch] of Object.entries(patched)) {
    if (!(key in ourPatched) && ourPackages.has(key.replace(/@[^@]+$/, ""))) {
      delete patched[key]
      changes.push(`patchedDependencies: dropped upstream ${key} (Kilo pins a different version)`)
      continue
    }
    if (patch && !(await Bun.file(patch).exists())) {
      delete patched[key]
      changes.push(`patchedDependencies: dropped ${key} (patch file ${patch} not present)`)
    }
  }
}

/**
 * Prune upstream-only catalog entries that have no consumers in Kilo.
 */
export function fixCatalog(pkg: Record<string, unknown>, path: string, changes: string[]): void {
  const ws = pkg.workspaces as { catalog?: Record<string, string> } | undefined
  const cat = ws?.catalog
  if (!cat) return
  for (const name of DELETE_UPSTREAM_CATALOG[path] || []) {
    if (cat[name]) {
      delete cat[name]
      changes.push(`workspaces.catalog.${name}: removed (upstream-only, no Kilo consumer)`)
    }
  }
}

/**
 * Check if file is a package.json
 */
export function isPackageJson(file: string): boolean {
  return file.endsWith("package.json")
}

/** Read a JSON object from a git merge stage, or null when the stage is missing. */
async function readStageJson(stage: string, file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await $`git show ${stage}${file}`.text())
  } catch {
    return null
  }
}

/** Read a JSON object from a git ref, or null when the file is missing. */
async function readRefJson(ref: string, file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await $`git show ${ref}:${file}`.text())
  } catch {
    return null
  }
}

/** The merge base of two refs, or null when git cannot find one. */
async function mergeBase(oursRef: string, theirsRef: string): Promise<string | null> {
  const result = await $`git merge-base ${oursRef} ${theirsRef}`.quiet().nothrow()
  if (result.exitCode !== 0) return null
  const sha = result.stdout.toString().trim()
  return sha || null
}

/**
 * Transform dependencies in package.json
 */
export function transformDependencies(deps: Record<string, string> | undefined): {
  result: Record<string, string>
  changes: string[]
} {
  if (!deps) return { result: {}, changes: [] }

  const result: Record<string, string> = {}
  const changes: string[] = []

  for (const [name, version] of Object.entries(deps)) {
    if (DELETE_UPSTREAM_DEPENDENCIES.has(name)) {
      changes.push(`${name}: removed (incompatible OpenTUI runtime)`)
      continue
    }
    const newName = PACKAGE_NAME_MAP[name]
    if (newName) {
      result[newName] = version
      changes.push(`${name} -> ${newName}`)
    } else {
      result[name] = version
    }
  }

  return { result, changes }
}

/**
 * Transform a package.json file
 */
export async function transformPackageJson(file: string, options: PackageJsonOptions = {}): Promise<PackageJsonResult> {
  const changes: string[] = []

  if (options.dryRun) {
    info(`[DRY-RUN] Would transform package.json: ${file}`)
    return { file, action: "transformed", changes: [], dryRun: true }
  }

  // If our version has kilocode_change markers, flag for manual resolution
  if (await oursHasKilocodeChanges(file)) {
    warn(`${file} has kilocode_change markers — skipping auto-transform, needs manual resolution`)
    return { file, action: "flagged", changes: [], dryRun: false }
  }

  try {
    // Save Kilo's version and the merge base BEFORE taking theirs
    let ourPkg = await readStageJson(":2:", file) // :2: is "ours" in merge
    if (!ourPkg) {
      // File might not exist in ours (new file from upstream), or we are not in a
      // merge conflict. Fall back to the current file when it has no conflict markers.
      try {
        const currentContent = await Bun.file(file).text()
        if (!currentContent.includes("<<<<<<<")) ourPkg = JSON.parse(currentContent)
      } catch {
        // File doesn't exist yet
      }
    }
    const basePkg = await readStageJson(":1:", file)

    // Take upstream's version
    await $`git checkout --theirs ${file}`.quiet().nothrow()
    await $`git add ${file}`.quiet().nothrow()

    // Read and parse upstream's version
    const content = await Bun.file(file).text()
    const pkg = JSON.parse(content)

    // 1. Transform package name if needed
    const relativePath = file.replace(process.cwd() + "/", "")
    const newName = TRANSFORM_PACKAGE_NAMES[relativePath]
    if (newName && pkg.name !== newName) {
      changes.push(`name: ${pkg.name} -> ${newName}`)
      pkg.name = newName
    }

    fixPackageManager(pkg, relativePath, ourPkg, changes)

    // 2. Preserve Kilo version only when the versions switch is on
    if (shouldPreserveVersion(options)) {
      const kiloVersion = await getCurrentVersion()
      if (pkg.version !== kiloVersion) {
        changes.push(`version: ${pkg.version} -> ${kiloVersion}`)
        pkg.version = kiloVersion
      }
    }

    // 3. Merge dependencies with "newest wins" strategy
    if (ourPkg) {
      pkg.dependencies = mergeWithNewestVersions(
        ourPkg.dependencies as Record<string, string> | undefined,
        pkg.dependencies,
        changes,
        "dependencies",
        basePkg?.dependencies as Record<string, string> | undefined,
      )

      pkg.devDependencies = mergeWithNewestVersions(
        ourPkg.devDependencies as Record<string, string> | undefined,
        pkg.devDependencies,
        changes,
        "devDependencies",
        basePkg?.devDependencies as Record<string, string> | undefined,
      )

      pkg.peerDependencies = mergeWithNewestVersions(
        ourPkg.peerDependencies as Record<string, string> | undefined,
        pkg.peerDependencies,
        changes,
        "peerDependencies",
        basePkg?.peerDependencies as Record<string, string> | undefined,
      )

      // 4. Preserve/merge overrides
      const ourOverrides = ourPkg.overrides as Record<string, string> | undefined
      if (ourOverrides || pkg.overrides) {
        pkg.overrides = mergeWithNewestVersions(
          ourOverrides,
          pkg.overrides,
          changes,
          "overrides",
          basePkg?.overrides as Record<string, string> | undefined,
        )
      }

      // 5. Preserve patchedDependencies (Kilo-specific, upstream won't have these)
      const ourPatchedDeps = ourPkg.patchedDependencies as Record<string, string> | undefined
      if (ourPatchedDeps) {
        pkg.patchedDependencies = pkg.patchedDependencies || {}
        await prunePatchedDependencies(pkg, ourPkg, changes)
        for (const [name, patch] of Object.entries(ourPatchedDeps)) {
          if (!pkg.patchedDependencies[name]) {
            pkg.patchedDependencies[name] = patch
            changes.push(`patchedDependencies: preserved ${name}`)
          }
        }
      }

      // 6. Preserve repository metadata only when Kilo changed it from the merge base
      fixRepository(pkg, ourPkg, basePkg, changes)

      // 7. Handle workspaces for root package.json. Keep Kilo's workspace packages only when
      // Kilo changed them from the merge base.
      const ourWorkspaces = ourPkg.workspaces as { packages?: string[]; catalog?: Record<string, string> } | undefined
      const theirWorkspaces = pkg.workspaces as { packages?: string[]; catalog?: Record<string, string> } | undefined

      preserveWorkspacePackages(pkg, ourPkg, basePkg, relativePath, changes)

      fixScripts(pkg, relativePath, ourPkg, changes)

      // Merge catalog with "newest wins" strategy
      if (ourWorkspaces?.catalog || theirWorkspaces?.catalog) {
        pkg.workspaces = pkg.workspaces || {}
        pkg.workspaces.catalog = mergeWithNewestVersions(
          ourWorkspaces?.catalog,
          theirWorkspaces?.catalog,
          changes,
          "workspaces.catalog",
          (basePkg?.workspaces as { catalog?: Record<string, string> } | undefined)?.catalog,
        )
      }

      fixCatalog(pkg, relativePath, changes)
      fixTrustedDependencies(pkg, relativePath, changes)
    }

    // 7. Transform dependency names (opencode -> kilo)
    if (pkg.dependencies) {
      const { result, changes: depChanges } = transformDependencies(pkg.dependencies)
      pkg.dependencies = result
      changes.push(...depChanges.map((c) => `dependencies: ${c}`))
    }

    if (pkg.devDependencies) {
      const { result, changes: devChanges } = transformDependencies(pkg.devDependencies)
      if (devChanges.length > 0) {
        pkg.devDependencies = result
        changes.push(...devChanges.map((c) => `devDependencies: ${c}`))
      }
    }

    if (pkg.peerDependencies) {
      const { result, changes: peerChanges } = transformDependencies(pkg.peerDependencies)
      if (peerChanges.length > 0) {
        pkg.peerDependencies = result
        changes.push(...peerChanges.map((c) => `peerDependencies: ${c}`))
      }
    }

    // 8. Inject Kilo-specific dependencies
    const kiloDeps = KILO_DEPENDENCIES[relativePath]
    if (kiloDeps) {
      pkg.dependencies = pkg.dependencies || {}
      for (const [name, version] of Object.entries(kiloDeps)) {
        if (!pkg.dependencies[name]) {
          pkg.dependencies[name] = version
          changes.push(`injected: ${name}`)
        }
      }
    }

    // 9. Set Kilo-specific bin entries
    const kiloBin = KILO_BIN[relativePath]
    if (kiloBin) {
      pkg.bin = kiloBin
      changes.push(`bin: set Kilo bin entries`)
    }

    // Write back with proper formatting
    const newContent = JSON.stringify(pkg, null, 2) + "\n"
    await Bun.write(file, newContent)
    await $`git add ${file}`.quiet().nothrow()

    if (changes.length > 0) {
      success(`Transformed ${file}: ${changes.length} changes`)
      if (options.verbose) {
        for (const change of changes) {
          debug(`  - ${change}`)
        }
      }
    }

    return { file, action: "transformed", changes, dryRun: false }
  } catch (err) {
    warn(`Failed to transform ${file}: ${err}`)
    return { file, action: "failed", changes: [], dryRun: false }
  }
}

/**
 * Transform conflicted package.json files
 */
export async function transformConflictedPackageJson(
  files: string[],
  options: PackageJsonOptions = {},
): Promise<PackageJsonResult[]> {
  const results: PackageJsonResult[] = []

  for (const file of files) {
    if (!isPackageJson(file)) {
      results.push({ file, action: "skipped", changes: [], dryRun: options.dryRun ?? false })
      continue
    }

    const result = await transformPackageJson(file, options)
    results.push(result)
  }

  return results
}

/**
 * Get Kilo's package.json from the base branch (default: v2) for comparison.
 * Used during pre-merge to compare upstream versions against Kilo's versions.
 */
async function getKiloPackageJson(
  path: string,
  baseBranch = defaultConfig.baseBranch,
): Promise<Record<string, unknown> | null> {
  try {
    const content = await $`git show origin/${baseBranch}:${path}`.text()
    return JSON.parse(content)
  } catch {
    // File might not exist in Kilo
    return null
  }
}

/**
 * Transform all package.json files (pre-merge, on opencode branch)
 * This function merges Kilo's versions with upstream, using "newest wins" strategy
 */
export async function transformAllPackageJson(options: PackageJsonOptions = {}): Promise<PackageJsonResult[]> {
  const { Glob } = await import("bun")
  const results: PackageJsonResult[] = []

  // Find all package.json files
  const glob = new Glob("**/package.json")

  for await (const path of glob.scan({ absolute: false })) {
    // Skip node_modules
    if (path.includes("node_modules")) continue

    const file = Bun.file(path)
    if (!(await file.exists())) continue

    try {
      const content = await file.text()
      const pkg = JSON.parse(content) // This is upstream's version
      const changes: string[] = []

      // Get Kilo's version from base branch for comparison
      const kiloPkg = await getKiloPackageJson(path)

      // 1. Transform package name if needed
      const newName = TRANSFORM_PACKAGE_NAMES[path]
      if (newName && pkg.name !== newName) {
        changes.push(`name: ${pkg.name} -> ${newName}`)
        pkg.name = newName
      }

      fixPackageManager(pkg, path, kiloPkg, changes)

      // 2. Preserve Kilo version only when the versions switch is on
      if (shouldPreserveVersion(options)) {
        const kiloVersion = await getCurrentVersion()
        if (pkg.version !== kiloVersion) {
          changes.push(`version: ${pkg.version} -> ${kiloVersion}`)
          pkg.version = kiloVersion
        }
      }

      // 3. Merge dependencies with "newest wins" strategy (if Kilo has this file)
      if (kiloPkg) {
        pkg.dependencies = mergeWithNewestVersions(
          kiloPkg.dependencies as Record<string, string> | undefined,
          pkg.dependencies,
          changes,
          "dependencies",
        )

        pkg.devDependencies = mergeWithNewestVersions(
          kiloPkg.devDependencies as Record<string, string> | undefined,
          pkg.devDependencies,
          changes,
          "devDependencies",
        )

        pkg.peerDependencies = mergeWithNewestVersions(
          kiloPkg.peerDependencies as Record<string, string> | undefined,
          pkg.peerDependencies,
          changes,
          "peerDependencies",
        )

        // 4. Preserve/merge overrides
        const kiloOverrides = kiloPkg.overrides as Record<string, string> | undefined
        if (kiloOverrides || pkg.overrides) {
          pkg.overrides = mergeWithNewestVersions(kiloOverrides, pkg.overrides, changes, "overrides")
        }

        // 5. Preserve patchedDependencies (Kilo-specific, upstream won't have these)
        const kiloPatchedDeps = kiloPkg.patchedDependencies as Record<string, string> | undefined
        if (kiloPatchedDeps) {
          pkg.patchedDependencies = pkg.patchedDependencies || {}
          await prunePatchedDependencies(pkg, kiloPkg, changes)
          for (const [name, patch] of Object.entries(kiloPatchedDeps)) {
            if (!pkg.patchedDependencies[name]) {
              pkg.patchedDependencies[name] = patch
              changes.push(`patchedDependencies: preserved ${name}`)
            }
          }
        }

        // 6. Preserve repository metadata (base is unknown pre-merge, so keep Kilo's values)
        fixRepository(pkg, kiloPkg, null, changes)

        // 7. Handle workspaces for root package.json. Keep Kilo's workspace packages when the
        // base is unknown.
        const kiloWorkspaces = kiloPkg.workspaces as
          | { packages?: string[]; catalog?: Record<string, string> }
          | undefined
        const upstreamWorkspaces = pkg.workspaces as
          | { packages?: string[]; catalog?: Record<string, string> }
          | undefined

        preserveWorkspacePackages(pkg, kiloPkg, null, path, changes)

        fixScripts(pkg, path, kiloPkg, changes)

        // Merge catalog with "newest wins" strategy
        if (kiloWorkspaces?.catalog || upstreamWorkspaces?.catalog) {
          pkg.workspaces = pkg.workspaces || {}
          pkg.workspaces.catalog = mergeWithNewestVersions(
            kiloWorkspaces?.catalog,
            upstreamWorkspaces?.catalog,
            changes,
            "workspaces.catalog",
          )
        }

        fixCatalog(pkg, path, changes)
        fixTrustedDependencies(pkg, path, changes)
      }

      // 7. Transform dependency names (opencode -> kilo)
      if (pkg.dependencies) {
        const { result, changes: depChanges } = transformDependencies(pkg.dependencies)
        if (depChanges.length > 0) {
          pkg.dependencies = result
          changes.push(...depChanges.map((c) => `dependencies: ${c}`))
        }
      }

      if (pkg.devDependencies) {
        const { result, changes: devChanges } = transformDependencies(pkg.devDependencies)
        if (devChanges.length > 0) {
          pkg.devDependencies = result
          changes.push(...devChanges.map((c) => `devDependencies: ${c}`))
        }
      }

      if (pkg.peerDependencies) {
        const { result, changes: peerChanges } = transformDependencies(pkg.peerDependencies)
        if (peerChanges.length > 0) {
          pkg.peerDependencies = result
          changes.push(...peerChanges.map((c) => `peerDependencies: ${c}`))
        }
      }

      // 8. Inject Kilo-specific dependencies
      const kiloDeps = KILO_DEPENDENCIES[path]
      if (kiloDeps) {
        pkg.dependencies = pkg.dependencies || {}
        for (const [name, version] of Object.entries(kiloDeps)) {
          if (!pkg.dependencies[name]) {
            pkg.dependencies[name] = version
            changes.push(`injected: ${name}`)
          }
        }
      }

      // 9. Set Kilo-specific bin entries
      const kiloBin = KILO_BIN[path]
      if (kiloBin) {
        pkg.bin = kiloBin
        changes.push(`bin: set Kilo bin entries`)
      }

      if (changes.length > 0) {
        if (!options.dryRun) {
          const newContent = JSON.stringify(pkg, null, 2) + "\n"
          await Bun.write(path, newContent)
          success(`Transformed ${path}: ${changes.length} changes`)
        } else {
          info(`[DRY-RUN] Would transform ${path}: ${changes.length} changes`)
        }
      }

      results.push({ file: path, action: "transformed", changes, dryRun: options.dryRun ?? false })
    } catch (err) {
      warn(`Failed to transform ${path}: ${err}`)
      results.push({ file: path, action: "failed", changes: [], dryRun: options.dryRun ?? false })
    }
  }

  return results
}

/**
 * Reconcile a single package.json after a merge has finished, regardless of
 * whether it was conflicted or auto-resolved (by rerere or git's textual
 * merge). Reads ours from `oursRef` and theirs from `theirsRef`, then applies
 * the same merge logic used for conflict resolution and writes the result to
 * the working tree. Stages the file.
 *
 * This is needed because rerere can replay stale resolutions for files like
 * `package.json` that include cosmetic reordering — those resolutions bypass
 * `transformConflictedPackageJson` entirely. Running this reconciler after
 * the merge guarantees our merge logic always wins.
 *
 * Returns "skipped" if neither side touched the file (or both sides match) so
 * callers can avoid unnecessary churn. Returns "flagged" if ours has
 * kilocode_change markers (manual review needed).
 */
export async function reconcilePackageJsonFromRefs(
  file: string,
  options: ReconcileOptions,
): Promise<PackageJsonResult> {
  const changes: string[] = []
  const dryRun = options.dryRun ?? false

  if (await oursHasKilocodeChanges(file)) {
    warn(`${file} has kilocode_change markers — skipping reconcile, needs manual resolution`)
    return { file, action: "flagged", changes: [], dryRun }
  }

  const ourPkg = await readRefJson(options.oursRef, file)

  let pkg = await readRefJson(options.theirsRef, file)

  if (!pkg) {
    if (!ourPkg) return { file, action: "skipped", changes: [], dryRun }
    pkg = JSON.parse(JSON.stringify(ourPkg))
  }
  if (!pkg) return { file, action: "skipped", changes: [], dryRun }

  const baseRef = options.baseRef ?? (await mergeBase(options.oursRef, options.theirsRef))
  const basePkg = baseRef ? await readRefJson(baseRef, file) : null

  const relativePath = file.replace(process.cwd() + "/", "")
  const newName = TRANSFORM_PACKAGE_NAMES[relativePath]
  if (newName && pkg.name !== newName) {
    changes.push(`name: ${pkg.name} -> ${newName}`)
    pkg.name = newName
  }

  fixPackageManager(pkg, relativePath, ourPkg, changes)

  if (shouldPreserveVersion(options)) {
    const kiloVersion = await getCurrentVersion()
    if (pkg.version !== kiloVersion) {
      changes.push(`version: ${pkg.version} -> ${kiloVersion}`)
      pkg.version = kiloVersion
    }
  }

  if (ourPkg) {
    pkg.dependencies = mergeWithNewestVersions(
      ourPkg.dependencies as Record<string, string> | undefined,
      pkg.dependencies as Record<string, string> | undefined,
      changes,
      "dependencies",
    )
    pkg.devDependencies = mergeWithNewestVersions(
      ourPkg.devDependencies as Record<string, string> | undefined,
      pkg.devDependencies as Record<string, string> | undefined,
      changes,
      "devDependencies",
    )
    pkg.peerDependencies = mergeWithNewestVersions(
      ourPkg.peerDependencies as Record<string, string> | undefined,
      pkg.peerDependencies as Record<string, string> | undefined,
      changes,
      "peerDependencies",
    )

    const ourOverrides = ourPkg.overrides as Record<string, string> | undefined
    if (ourOverrides || pkg.overrides) {
      pkg.overrides = mergeWithNewestVersions(
        ourOverrides,
        pkg.overrides as Record<string, string> | undefined,
        changes,
        "overrides",
      )
    }

    const ourPatched = ourPkg.patchedDependencies as Record<string, string> | undefined
    if (ourPatched) {
      pkg.patchedDependencies = (pkg.patchedDependencies as Record<string, string>) || {}
      await prunePatchedDependencies(pkg, ourPkg, changes)
      const patched = pkg.patchedDependencies as Record<string, string>
      for (const [name, patch] of Object.entries(ourPatched)) {
        if (!patched[name]) {
          patched[name] = patch
          changes.push(`patchedDependencies: preserved ${name}`)
        }
      }
    }

    // Preserve repository metadata only when Kilo changed it from the merge base
    fixRepository(pkg, ourPkg, basePkg, changes)

    const ourWs = ourPkg.workspaces as { packages?: string[]; catalog?: Record<string, string> } | undefined
    const theirWs = pkg.workspaces as { packages?: string[]; catalog?: Record<string, string> } | undefined

    preserveWorkspacePackages(pkg, ourPkg, basePkg, relativePath, changes)

    fixScripts(pkg, relativePath, ourPkg, changes)

    if (ourWs?.catalog || theirWs?.catalog) {
      pkg.workspaces = (pkg.workspaces as Record<string, unknown>) || {}
      const catalog = mergeWithNewestVersions(ourWs?.catalog, theirWs?.catalog, changes, "workspaces.catalog")
      ;(pkg.workspaces as { catalog: Record<string, string> }).catalog = catalog ?? {}
    }

    fixCatalog(pkg, relativePath, changes)
    fixTrustedDependencies(pkg, relativePath, changes)
  }

  if (pkg.dependencies) {
    const { result, changes: depChanges } = transformDependencies(pkg.dependencies as Record<string, string>)
    pkg.dependencies = result
    changes.push(...depChanges.map((c) => `dependencies: ${c}`))
  }
  if (pkg.devDependencies) {
    const { result, changes: devChanges } = transformDependencies(pkg.devDependencies as Record<string, string>)
    if (devChanges.length > 0) {
      pkg.devDependencies = result
      changes.push(...devChanges.map((c) => `devDependencies: ${c}`))
    }
  }
  if (pkg.peerDependencies) {
    const { result, changes: peerChanges } = transformDependencies(pkg.peerDependencies as Record<string, string>)
    if (peerChanges.length > 0) {
      pkg.peerDependencies = result
      changes.push(...peerChanges.map((c) => `peerDependencies: ${c}`))
    }
  }

  const kiloDeps = KILO_DEPENDENCIES[relativePath]
  if (kiloDeps) {
    pkg.dependencies = (pkg.dependencies as Record<string, string>) || {}
    const deps = pkg.dependencies as Record<string, string>
    for (const [name, version] of Object.entries(kiloDeps)) {
      if (!deps[name]) {
        deps[name] = version
        changes.push(`injected: ${name}`)
      }
    }
  }

  const kiloBin = KILO_BIN[relativePath]
  if (kiloBin) {
    pkg.bin = kiloBin
    changes.push(`bin: set Kilo bin entries`)
  }

  if (dryRun) {
    info(`[DRY-RUN] Would reconcile ${file}: ${changes.length} changes`)
    return { file, action: "transformed", changes, dryRun: true }
  }

  const newContent = JSON.stringify(pkg, null, 2) + "\n"
  await Bun.write(file, newContent)
  await $`git add ${file}`.quiet().nothrow()

  if (changes.length > 0) {
    success(`Reconciled ${file}: ${changes.length} changes`)
    if (options.verbose) {
      for (const change of changes) debug(`  - ${change}`)
    }
  }

  return { file, action: "transformed", changes, dryRun: false }
}

/**
 * Reconcile every package.json that differs between `oursRef` and `theirsRef`
 * after a merge. This is meant to run after `git merge` (whether the merge
 * was clean, conflict-resolved, or rerere-replayed) to ensure our merge logic
 * is the source of truth for package.json content.
 */
export async function reconcileAllPackageJson(options: ReconcileOptions): Promise<PackageJsonResult[]> {
  // Collect every package.json that differs in either direction so we cover
  // upstream-only and kilo-only files alike.
  const diffOurs = await $`git diff --name-only ${options.oursRef} -- '*package.json'`.text()
  const diffTheirs = await $`git diff --name-only ${options.theirsRef} -- '*package.json'`.text()
  const candidates = new Set<string>()
  for (const line of [...diffOurs.split("\n"), ...diffTheirs.split("\n")]) {
    const path = line.trim()
    if (!path) continue
    if (path.includes("node_modules")) continue
    if (!path.endsWith("package.json")) continue
    candidates.add(path)
  }

  const results: PackageJsonResult[] = []
  for (const file of candidates) {
    if (options.skip?.has(file)) {
      results.push({ file, action: "skipped", changes: [], dryRun: options.dryRun ?? false })
      continue
    }
    const f = Bun.file(file)
    if (!(await f.exists())) {
      // file was removed by the merge - nothing to reconcile
      continue
    }
    results.push(await reconcilePackageJsonFromRefs(file, options))
  }
  return results
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const verbose = args.includes("--verbose")

  const files = args.filter((a) => !a.startsWith("--"))

  if (files.length === 0) {
    info("Usage: transform-package-json.ts [--dry-run] [--verbose] <file1> <file2> ...")
    process.exit(1)
  }

  if (dryRun) {
    info("Running in dry-run mode")
  }

  const results = await transformConflictedPackageJson(files, { dryRun, verbose })

  const transformed = results.filter((r) => r.action === "transformed")
  const totalChanges = results.reduce((sum, r) => sum + r.changes.length, 0)

  console.log()
  success(`Transformed ${transformed.length} package.json files with ${totalChanges} changes`)

  if (dryRun) {
    info("Run without --dry-run to apply changes")
  }
}
