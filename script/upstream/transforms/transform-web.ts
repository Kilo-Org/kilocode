#!/usr/bin/env bun
/**
 * Transform web/docs files with Kilo branding
 *
 * This script handles documentation and web content files (.mdx, etc.)
 * by transforming OpenCode references to Kilo.
 */

import { $ } from "bun"
import { info, success, warn, debug } from "../utils/logger"
import { defaultConfig } from "../utils/config"

export interface WebTransformResult {
  file: string
  action: "transformed" | "skipped" | "failed"
  replacements: number
  dryRun: boolean
}

export interface WebTransformOptions {
  dryRun?: boolean
  verbose?: boolean
}

interface WebReplacement {
  pattern: RegExp
  replacement: string
  description: string
}

// Web/docs replacements
const WEB_REPLACEMENTS: WebReplacement[] = [
  // GitHub references
  {
    pattern: /github\.com\/anomalyco\/opencode/g,
    replacement: "github.com/Kilo-Org/kilocode",
    description: "GitHub URL",
  },
  {
    pattern: /anomalyco\/opencode/g,
    replacement: "Kilo-Org/kilo",
    description: "GitHub repo",
  },

  // Domains
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

  // Product names
  {
    pattern: /OpenCode Desktop/g,
    replacement: "Kilo Desktop",
    description: "Desktop name",
  },
  {
    pattern: /\bOpenCode\b(?!\.json|\/| Zen)/g,
    replacement: "Kilo",
    description: "Product name",
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
    pattern: /opencode upgrade/g,
    replacement: "kilo upgrade",
    description: "upgrade command",
  },
  {
    pattern: /opencode dev/g,
    replacement: "kilo dev",
    description: "dev command",
  },
  {
    pattern: /opencode serve/g,
    replacement: "kilo serve",
    description: "serve command",
  },
  {
    pattern: /opencode auth/g,
    replacement: "kilo auth",
    description: "auth command",
  },
]

// Patterns to preserve
const PRESERVE_PATTERNS = [/opencode\.json/g, /\.opencode\//g, /`\.opencode`/g]

/**
 * Check if file is a web/docs file
 */
export function isWebFile(file: string): boolean {
  const patterns = defaultConfig.webFiles

  return patterns.some((pattern) => {
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$")
    return regex.test(file)
  })
}

/**
 * Apply web transforms to content
 */
export function applyWebTransforms(content: string, verbose = false): { result: string; replacements: number } {
  const lines = content.split("\n")
  const transformed: string[] = []
  let total = 0

  for (const line of lines) {
    // Check if line has preserve patterns
    let hasPreserve = false
    for (const pattern of PRESERVE_PATTERNS) {
      pattern.lastIndex = 0
      if (pattern.test(line)) {
        hasPreserve = true
        pattern.lastIndex = 0
      }
    }

    // If line has preserve patterns, skip transformation
    if (hasPreserve) {
      transformed.push(line)
      continue
    }

    let result = line
    let count = 0

    for (const { pattern, replacement, description } of WEB_REPLACEMENTS) {
      pattern.lastIndex = 0

      if (pattern.test(result)) {
        pattern.lastIndex = 0
        const before = result
        result = result.replace(pattern, replacement)

        if (before !== result) {
          count++
          if (verbose) debug(`  ${description}`)
        }
      }
    }

    transformed.push(result)
    total += count
  }

  return { result: transformed.join("\n"), replacements: total }
}

/**
 * Transform a web/docs file
 */
export async function transformWebFile(file: string, options: WebTransformOptions = {}): Promise<WebTransformResult> {
  if (options.dryRun) {
    info(`[DRY-RUN] Would transform web file: ${file}`)
    return { file, action: "transformed", replacements: 0, dryRun: true }
  }

  try {
    // Take upstream's version first
    await $`git checkout --theirs ${file}`.quiet().nothrow()
    await $`git add ${file}`.quiet().nothrow()

    // Read content
    const content = await Bun.file(file).text()

    // Apply transforms
    const { result, replacements } = applyWebTransforms(content, options.verbose)

    // Write back if changed
    if (replacements > 0) {
      await Bun.write(file, result)
      await $`git add ${file}`.quiet().nothrow()
    }

    success(`Transformed web file ${file}: ${replacements} replacements`)
    return { file, action: "transformed", replacements, dryRun: false }
  } catch (err) {
    warn(`Failed to transform web file ${file}: ${err}`)
    return { file, action: "failed", replacements: 0, dryRun: false }
  }
}

/**
 * Transform conflicted web files
 */
export async function transformConflictedWeb(
  files: string[],
  options: WebTransformOptions = {},
): Promise<WebTransformResult[]> {
  const results: WebTransformResult[] = []

  for (const file of files) {
    if (!isWebFile(file)) {
      debug(`Skipping ${file} - not a web file`)
      results.push({ file, action: "skipped", replacements: 0, dryRun: options.dryRun ?? false })
      continue
    }

    const result = await transformWebFile(file, options)
    results.push(result)
  }

  return results
}

/**
 * Transform all web/docs files (pre-merge, on opencode branch)
 */
export async function transformAllWeb(options: WebTransformOptions = {}): Promise<WebTransformResult[]> {
  const { Glob } = await import("bun")
  const results: WebTransformResult[] = []
  const patterns = defaultConfig.webFiles

  for (const pattern of patterns) {
    const glob = new Glob(pattern)

    for await (const path of glob.scan({ absolute: false })) {
      const file = Bun.file(path)
      if (!(await file.exists())) continue

      try {
        const content = await file.text()
        const { result, replacements } = applyWebTransforms(content, options.verbose)

        if (replacements > 0 && !options.dryRun) {
          await Bun.write(path, result)
          success(`Transformed web ${path}: ${replacements} replacements`)
        } else if (options.dryRun && replacements > 0) {
          info(`[DRY-RUN] Would transform web ${path}: ${replacements} replacements`)
        }

        results.push({ file: path, action: "transformed", replacements, dryRun: options.dryRun ?? false })
      } catch (err) {
        warn(`Failed to transform web ${path}: ${err}`)
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
    info("Usage: transform-web.ts [--dry-run] [--verbose] <file1> <file2> ...")
    process.exit(1)
  }

  if (dryRun) {
    info("Running in dry-run mode")
  }

  const results = await transformConflictedWeb(files, { dryRun, verbose })

  const transformed = results.filter((r) => r.action === "transformed")
  const total = results.reduce((sum, r) => sum + r.replacements, 0)

  console.log()
  success(`Transformed ${transformed.length} web files with ${total} replacements`)

  if (dryRun) {
    info("Run without --dry-run to apply changes")
  }
}
