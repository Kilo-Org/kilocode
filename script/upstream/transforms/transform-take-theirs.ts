#!/usr/bin/env bun
/**
 * Transform files by taking upstream version and applying Kilo branding
 *
 * This script handles files that have only branding differences (no logic changes).
 * It takes the upstream version and applies Kilo branding transforms.
 *
 * Use this for:
 * - UI components with OpenCode -> Kilo branding
 * - Config files with predictable patterns
 * - Files without kilocode_change logic blocks
 */

import { $ } from "bun"
import { info, success, warn, debug } from "../utils/logger"
import { defaultConfig } from "../utils/config"

export interface TakeTheirsResult {
  file: string
  action: "transformed" | "skipped" | "failed"
  replacements: number
  dryRun: boolean
}

export interface TakeTheirsOptions {
  dryRun?: boolean
  verbose?: boolean
  patterns?: string[]
}

interface BrandingReplacement {
  pattern: RegExp
  replacement: string
  description: string
}

// Branding replacements - order matters (specific patterns first)
const BRANDING_REPLACEMENTS: BrandingReplacement[] = [
  // GitHub repo references
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

  // Domain replacements (specific first)
  {
    pattern: /app\.opencode\.ai/g,
    replacement: "app.kilo.ai",
    description: "App domain",
  },
  {
    pattern: /opencode\.ai(?!\/zen)/g,
    replacement: "kilo.ai",
    description: "Main domain (excluding zen)",
  },

  // Product name (specific phrases first)
  {
    pattern: /OpenCode Desktop/g,
    replacement: "Kilo Desktop",
    description: "Desktop app name",
  },

  // CLI commands
  {
    pattern: /npx opencode(?!\w)/g,
    replacement: "npx kilo",
    description: "npx command",
  },
  {
    pattern: /bun add opencode(?!\w)/g,
    replacement: "bun add kilo",
    description: "bun add command",
  },
  {
    pattern: /npm install opencode(?!\w)/g,
    replacement: "npm install kilo",
    description: "npm install command",
  },
  {
    pattern: /opencode upgrade(?!\w)/g,
    replacement: "kilo upgrade",
    description: "upgrade command",
  },

  // Database filename
  {
    pattern: /opencode\.db/g,
    replacement: "kilo.db",
    description: "Database filename",
  },

  // Generic product name replacement (must come after specific patterns)
  // Only replace "OpenCode" when it's a standalone word
  {
    pattern: /\bOpenCode\b(?!\.json|\/| Zen)/g,
    replacement: "Kilo",
    description: "Product name",
  },

  // Environment variables (exclude OPENCODE_API_KEY)
  {
    pattern: /\bOPENCODE_(?!API_KEY\b)([A-Z_]+)\b/g,
    replacement: "KILO_$1",
    description: "Environment variable",
  },
  {
    pattern: /VITE_OPENCODE_/g,
    replacement: "VITE_KILO_",
    description: "Vite env var",
  },
  {
    pattern: /window\.__OPENCODE__/g,
    replacement: "window.__KILO__",
    description: "Window global",
  },
  {
    pattern: /x-opencode-client/g,
    replacement: "x-kilo-client",
    description: "HTTP header",
  },
  {
    pattern: /_EXTENSION_OPENCODE_/g,
    replacement: "_EXTENSION_KILO_",
    description: "Extension env var",
  },
]

// Patterns that should NOT be replaced (preserved as-is)
const PRESERVE_PATTERNS = [
  /opencode\.json/g, // Config filename
  /\.opencode\//g, // Directory name
  /\.opencode`/g, // Directory name in template strings
  /"\.opencode"/g, // Directory name in quotes
  /'\.opencode'/g, // Directory name in single quotes
  /\/\/\s*kilocode_change/g, // Already has marker
]

/**
 * Check if a file matches any of the patterns
 */
export function matchesPattern(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Convert glob pattern to regex
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$")
    return regex.test(file)
  })
}

/**
 * Apply branding transforms to content
 */
export function applyBrandingTransforms(content: string, verbose = false): { result: string; replacements: number } {
  const lines = content.split("\n")
  const transformed: string[] = []
  let total = 0

  for (const line of lines) {
    // Skip lines with kilocode_change marker (already customized)
    if (line.includes("// kilocode_change")) {
      transformed.push(line)
      continue
    }

    // Check if line has preserve patterns
    let hasPreserve = false
    for (const pattern of PRESERVE_PATTERNS) {
      pattern.lastIndex = 0
      if (pattern.test(line)) {
        hasPreserve = true
        pattern.lastIndex = 0
      }
    }

    let result = line
    let count = 0

    // Apply replacements
    for (const { pattern, replacement, description } of BRANDING_REPLACEMENTS) {
      pattern.lastIndex = 0

      if (pattern.test(result)) {
        pattern.lastIndex = 0
        const before = result
        result = result.replace(pattern, replacement)

        if (before !== result) {
          count++
          if (verbose) debug(`  ${description}: "${before.trim()}" -> "${result.trim()}"`)
        }
      }
    }

    transformed.push(result)
    total += count
  }

  return { result: transformed.join("\n"), replacements: total }
}

/**
 * Take upstream version of a file and apply branding transforms
 */
export async function transformTakeTheirs(file: string, options: TakeTheirsOptions = {}): Promise<TakeTheirsResult> {
  if (options.dryRun) {
    info(`[DRY-RUN] Would take theirs and transform: ${file}`)
    return { file, action: "transformed", replacements: 0, dryRun: true }
  }

  try {
    // Take upstream's version
    await $`git checkout --theirs ${file}`.quiet().nothrow()
    await $`git add ${file}`.quiet().nothrow()

    // Read the file
    const content = await Bun.file(file).text()

    // Apply branding transforms
    const { result, replacements } = applyBrandingTransforms(content, options.verbose)

    // Write back
    if (replacements > 0) {
      await Bun.write(file, result)
      await $`git add ${file}`.quiet().nothrow()
    }

    success(`Transformed ${file}: took upstream + ${replacements} branding replacements`)
    return { file, action: "transformed", replacements, dryRun: false }
  } catch (err) {
    warn(`Failed to transform ${file}: ${err}`)
    return { file, action: "failed", replacements: 0, dryRun: false }
  }
}

/**
 * Transform multiple files that are in conflict
 */
export async function transformConflictedTakeTheirs(
  files: string[],
  options: TakeTheirsOptions = {},
): Promise<TakeTheirsResult[]> {
  const results: TakeTheirsResult[] = []
  const patterns = options.patterns || defaultConfig.takeTheirsAndTransform

  for (const file of files) {
    if (!matchesPattern(file, patterns)) {
      debug(`Skipping ${file} - doesn't match take-theirs patterns`)
      results.push({ file, action: "skipped", replacements: 0, dryRun: options.dryRun ?? false })
      continue
    }

    const result = await transformTakeTheirs(file, options)
    results.push(result)
  }

  return results
}

/**
 * Check if a file should use take-theirs strategy
 */
export function shouldTakeTheirs(file: string, patterns?: string[]): boolean {
  const p = patterns || defaultConfig.takeTheirsAndTransform
  return matchesPattern(file, p)
}

/**
 * Transform all files matching take-theirs patterns (pre-merge, on opencode branch)
 * This applies branding transforms to files that exist on the current branch
 */
export async function transformAllTakeTheirs(options: TakeTheirsOptions = {}): Promise<TakeTheirsResult[]> {
  const { Glob } = await import("bun")
  const results: TakeTheirsResult[] = []
  const patterns = options.patterns || defaultConfig.takeTheirsAndTransform

  for (const pattern of patterns) {
    const glob = new Glob(pattern)

    for await (const path of glob.scan({ absolute: false })) {
      // Skip if file doesn't exist
      const file = Bun.file(path)
      if (!(await file.exists())) continue

      try {
        const content = await file.text()
        const { result, replacements } = applyBrandingTransforms(content, options.verbose)

        if (replacements > 0 && !options.dryRun) {
          await Bun.write(path, result)
          success(`Transformed ${path}: ${replacements} branding replacements`)
        } else if (options.dryRun && replacements > 0) {
          info(`[DRY-RUN] Would transform ${path}: ${replacements} branding replacements`)
        }

        results.push({ file: path, action: "transformed", replacements, dryRun: options.dryRun ?? false })
      } catch (err) {
        warn(`Failed to transform ${path}: ${err}`)
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
    info("Usage: transform-take-theirs.ts [--dry-run] [--verbose] <file1> <file2> ...")
    process.exit(1)
  }

  if (dryRun) {
    info("Running in dry-run mode (no files will be modified)")
  }

  const results = await transformConflictedTakeTheirs(files, { dryRun, verbose })

  const transformed = results.filter((r) => r.action === "transformed")
  const total = results.reduce((sum, r) => sum + r.replacements, 0)

  console.log()
  success(`Transformed ${transformed.length} files with ${total} replacements`)

  if (dryRun) {
    info("Run without --dry-run to apply changes")
  }
}
