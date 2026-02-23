#!/usr/bin/env bun
/**
 * Transform script files with GitHub API references
 *
 * This script handles script files that contain GitHub API references
 * by transforming them from anomalyco/opencode to Kilo-Org/kilo.
 */

import { $ } from "bun"
import { info, success, warn, debug } from "../utils/logger"
import { defaultConfig } from "../utils/config"

export interface ScriptTransformResult {
  file: string
  action: "transformed" | "skipped" | "failed"
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
    replacement: "api.github.com/repos/Kilo-Org/kilo",
    description: "GitHub API URL",
  },
  {
    pattern: /\/repos\/anomalyco\/opencode/g,
    replacement: "/repos/Kilo-Org/kilo",
    description: "GitHub repos path",
  },

  // gh CLI commands
  {
    pattern: /gh api "\/repos\/anomalyco\/opencode/g,
    replacement: 'gh api "/repos/Kilo-Org/kilo',
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
    replacement: "Kilo-Org/kilo",
    description: "GitHub repo reference",
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

  return patterns.some((pattern) => {
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$")
    return regex.test(file)
  })
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
    info(`[DRY-RUN] Would transform script: ${file}`)
    return { file, action: "transformed", replacements: 0, dryRun: true }
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
  const dryRun = args.includes("--dry-run")
  const verbose = args.includes("--verbose")

  const files = args.filter((a) => !a.startsWith("--"))

  if (files.length === 0) {
    info("Usage: transform-scripts.ts [--dry-run] [--verbose] <file1> <file2> ...")
    process.exit(1)
  }

  if (dryRun) {
    info("Running in dry-run mode")
  }

  const results = await transformConflictedScripts(files, { dryRun, verbose })

  const transformed = results.filter((r) => r.action === "transformed")
  const total = results.reduce((sum, r) => sum + r.replacements, 0)

  console.log()
  success(`Transformed ${transformed.length} script files with ${total} replacements`)

  if (dryRun) {
    info("Run without --dry-run to apply changes")
  }
}
