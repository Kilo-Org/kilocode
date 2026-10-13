#!/usr/bin/env bun
/**
 * Transform script files with GitHub API references
 *
 * This script handles script files that contain GitHub API references
 * by transforming them from anomalyco/opencode to Kilo-Org/kilocode.
 */

import { $ } from "bun"
import { info, success, warn, debug, error } from "../utils/logger"
import { defaultConfig } from "../utils/config"
import { oursHasKilocodeChanges } from "../utils/git"
import { isKiloOwned } from "../utils/owned"
import { matches as matchAny } from "../utils/match"

export interface ScriptTransformResult {
  file: string
  action: "transformed" | "skipped" | "failed" | "flagged"
  replacements: number
  dryRun: boolean
}

export interface ScriptTransformOptions {
  dryRun?: boolean
  verbose?: boolean
}

interface ScriptReplacement {
  pattern: RegExp
  replacement: string
  description: string
}

// Script-specific replacements
const SCRIPT_REPLACEMENTS: ScriptReplacement[] = [
  // GitHub API URLs
  {
    pattern: /api\.github\.com\/repos\/anomalyco\/opencode/g,
    replacement: "api.github.com/repos/Kilo-Org/kilocode",
    description: "GitHub API URL",
  },
  {
    pattern: /\/repos\/anomalyco\/opencode/g,
    replacement: "/repos/Kilo-Org/kilocode",
    description: "GitHub repos path",
  },

  // gh CLI commands
  {
    pattern: /gh api "\/repos\/anomalyco\/opencode/g,
    replacement: 'gh api "/repos/Kilo-Org/kilocode',
    description: "gh api command",
  },

  // Direct GitHub references
  {
    pattern: /github\.com\/anomalyco\/opencode/g,
    replacement: "github.com/Kilo-Org/kilocode",
    description: "GitHub URL",
  },
  {
    pattern: /anomalyco\/opencode/g,
    replacement: "Kilo-Org/kilocode",
    description: "GitHub repo reference",
  },

  // Release artifact names
  {
    pattern: /opencode-(linux|darwin|windows)-(arm64|x64)(-baseline)?(\.tar\.gz|\.zip)?/g,
    replacement: "kilo-$1-$2$3$4",
    description: "Release artifact name",
  },

  // Environment variables (exclude OPENCODE_API_KEY)
  {
    pattern: /\bOPENCODE_(?!API_KEY\b)([A-Z_]+)\b/g,
    replacement: "KILO_$1",
    description: "Environment variable",
  },

  // OpenCode branding in strings
  {
    pattern: /"OpenCode"/g,
    replacement: '"Kilo"',
    description: "Product name in string",
  },
  {
    pattern: /'OpenCode'/g,
    replacement: "'Kilo'",
    description: "Product name in single quotes",
  },
]

/**
 * Check if file is a script file
 */
export function isScriptFile(file: string): boolean {
  const patterns = defaultConfig.scriptFiles

  return matchAny(file, patterns)
}

/**
 * Apply script transforms to content
 */
export function applyScriptTransforms(content: string, verbose = false): { result: string; replacements: number } {
  let result = content
  let total = 0

  for (const { pattern, replacement, description } of SCRIPT_REPLACEMENTS) {
    pattern.lastIndex = 0

    if (pattern.test(result)) {
      pattern.lastIndex = 0
      const before = result
      result = result.replace(pattern, replacement)

      if (before !== result) {
        total++
        if (verbose) debug(`  ${description}`)
      }
    }
  }

  return { result, replacements: total }
}

/**
 * Transform a script file
 */
export async function transformScriptFile(
  file: string,
  options: ScriptTransformOptions = {},
): Promise<ScriptTransformResult> {
  if (options.dryRun) {
    const content = await Bun.file(file)
      .text()
      .catch(() => "")
    const { replacements } = applyScriptTransforms(content, options.verbose)
    info(`[DRY-RUN] Would transform script ${file}: ${replacements} replacements`)
    return { file, action: "transformed", replacements, dryRun: true }
  }

  // If our version has kilocode_change markers, flag for manual resolution
  if (await oursHasKilocodeChanges(file)) {
    warn(`${file} has kilocode_change markers — skipping auto-transform, needs manual resolution`)
    return { file, action: "flagged", replacements: 0, dryRun: false }
  }

  try {
    // Take upstream's version first
    await $`git checkout --theirs ${file}`.quiet().nothrow()
    await $`git add ${file}`.quiet().nothrow()

    // Read content
    const content = await Bun.file(file).text()

    // Apply transforms
    const { result, replacements } = applyScriptTransforms(content, options.verbose)

    // Write back if changed
    if (replacements > 0) {
      await Bun.write(file, result)
      await $`git add ${file}`.quiet().nothrow()
    }

    success(`Transformed script ${file}: ${replacements} replacements`)
    return { file, action: "transformed", replacements, dryRun: false }
  } catch (err) {
    warn(`Failed to transform script ${file}: ${err}`)
    return { file, action: "failed", replacements: 0, dryRun: false }
  }
}

/**
 * Transform conflicted script files
 */
export async function transformConflictedScripts(
  files: string[],
  options: ScriptTransformOptions = {},
): Promise<ScriptTransformResult[]> {
  const results: ScriptTransformResult[] = []

  for (const file of files) {
    if (!isScriptFile(file)) {
      debug(`Skipping ${file} - not a script file`)
      results.push({ file, action: "skipped", replacements: 0, dryRun: options.dryRun ?? false })
      continue
    }

    const result = await transformScriptFile(file, options)
    results.push(result)
  }

  return results
}

/**
 * Transform all script files (pre-merge, on opencode branch)
 */
export async function transformAllScripts(options: ScriptTransformOptions = {}): Promise<ScriptTransformResult[]> {
  const { Glob } = await import("bun")
  const results: ScriptTransformResult[] = []
  const patterns = defaultConfig.scriptFiles

  for (const pattern of patterns) {
    const glob = new Glob(pattern)

    for await (const path of glob.scan({ absolute: false })) {
      // Kilo-owned paths are Kilo code: never rebrand them.
      if (isKiloOwned(path)) continue
      const file = Bun.file(path)
      if (!(await file.exists())) continue

      try {
        const content = await file.text()
        const { result, replacements } = applyScriptTransforms(content, options.verbose)

        if (replacements > 0 && !options.dryRun) {
          await Bun.write(path, result)
          success(`Transformed script ${path}: ${replacements} replacements`)
        } else if (options.dryRun && replacements > 0) {
          info(`[DRY-RUN] Would transform script ${path}: ${replacements} replacements`)
        }

        results.push({ file: path, action: "transformed", replacements, dryRun: options.dryRun ?? false })
      } catch (err) {
        warn(`Failed to transform script ${path}: ${err}`)
        results.push({ file: path, action: "failed", replacements: 0, dryRun: options.dryRun ?? false })
      }
    }
  }

  return results
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2)
  const apply = args.includes("--apply")
  const force = args.includes("--force")
  const verbose = args.includes("--verbose")

  const files = args.filter((a) => !a.startsWith("--"))

  if (apply && !defaultConfig.transforms.branding && !force) {
    error("Branding transforms are off in the v2 config (transforms.branding); pass --force to apply")
    process.exit(1)
  }

  const dryRun = !apply
  const results =
    files.length > 0
      ? await transformConflictedScripts(files, { dryRun, verbose })
      : await transformAllScripts({ dryRun, verbose })

  const transformed = results.filter((r) => r.action === "transformed")
  const total = results.reduce((sum, r) => sum + r.replacements, 0)

  for (const result of results) {
    if (result.replacements > 0) console.log(`${result.file}: ${result.replacements} replacement(s)`)
  }

  console.log()
  success(apply ? `Transformed ${transformed.length} script files with ${total} replacements` : `Would transform ${transformed.length} script files with ${total} replacements`)

  if (!apply) info("Run with --apply to write changes")
}
