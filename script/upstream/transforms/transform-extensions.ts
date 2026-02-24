#!/usr/bin/env bun
/**
 * Transform extension files (Zed, etc.) with Kilo branding
 *
 * This script handles extension configuration files by transforming
 * OpenCode references to Kilo.
 */

import { $ } from "bun"
import { info, success, warn, debug } from "../utils/logger"
import { defaultConfig } from "../utils/config"

export interface ExtensionTransformResult {
  file: string
  action: "transformed" | "skipped" | "failed"
  replacements: number
  dryRun: boolean
}

export interface ExtensionTransformOptions {
  dryRun?: boolean
  verbose?: boolean
}

interface ExtensionReplacement {
  pattern: RegExp
  replacement: string
  description: string
  fileTypes?: string[]
}

// Extension-specific replacements
const EXTENSION_REPLACEMENTS: ExtensionReplacement[] = [
  // TOML files (Zed extension)
  {
    pattern: /name\s*=\s*"opencode"/g,
    replacement: 'name = "kilo"',
    description: "Extension name",
    fileTypes: [".toml"],
  },
  {
    pattern: /id\s*=\s*"opencode"/g,
    replacement: 'id = "kilo"',
    description: "Extension ID",
    fileTypes: [".toml"],
  },
  {
    pattern: /description\s*=\s*"OpenCode[^"]*"/g,
    replacement: 'description = "Kilo - AI coding assistant"',
    description: "Extension description",
    fileTypes: [".toml"],
  },

  // GitHub/Repository references
  {
    pattern: /repository\s*=\s*"[^"]*anomalyco\/opencode[^"]*"/g,
    replacement: 'repository = "https://github.com/Kilo-Org/kilocode"',
    description: "Repository URL",
    fileTypes: [".toml"],
  },
  {
    pattern: /github\.com\/anomalyco\/opencode/g,
    replacement: "github.com/Kilo-Org/kilocode",
    description: "GitHub URL",
  },
  {
    pattern: /anomalyco\/opencode/g,
    replacement: "Kilo-Org/kilocode",
    description: "GitHub repo",
  },

  // Binary/command references
  {
    pattern: /command\s*=\s*"opencode"/g,
    replacement: 'command = "kilo"',
    description: "Command name",
    fileTypes: [".toml"],
  },

  // Generic OpenCode -> Kilo in strings
  {
    pattern: /"OpenCode"/g,
    replacement: '"Kilo"',
    description: "Product name",
  },

  // Environment variables
  {
    pattern: /_EXTENSION_OPENCODE_/g,
    replacement: "_EXTENSION_KILO_",
    description: "Extension env var",
  },
  {
    pattern: /OpenCode\s+language\s+server/gi,
    replacement: "Kilo language server",
    description: "Language server name",
  },
]

/**
 * Check if file is an extension file
 */
export function isExtensionFile(file: string): boolean {
  const patterns = defaultConfig.extensionFiles

  return patterns.some((pattern) => {
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$")
    return regex.test(file)
  })
}

/**
 * Get file extension
 */
function getExtension(file: string): string {
  const match = file.match(/\.[^.]+$/)
  return match ? match[0] : ""
}

/**
 * Apply extension transforms to content
 */
export function applyExtensionTransforms(
  content: string,
  file: string,
  verbose = false,
): { result: string; replacements: number } {
  const ext = getExtension(file)
  let result = content
  let total = 0

  for (const { pattern, replacement, description, fileTypes } of EXTENSION_REPLACEMENTS) {
    // Skip if this replacement is for specific file types and doesn't match
    if (fileTypes && !fileTypes.includes(ext)) {
      continue
    }

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
 * Transform an extension file
 */
export async function transformExtensionFile(
  file: string,
  options: ExtensionTransformOptions = {},
): Promise<ExtensionTransformResult> {
  if (options.dryRun) {
    info(`[DRY-RUN] Would transform extension: ${file}`)
    return { file, action: "transformed", replacements: 0, dryRun: true }
  }

  try {
    // Take upstream's version first
    await $`git checkout --theirs ${file}`.quiet().nothrow()
    await $`git add ${file}`.quiet().nothrow()

    // Read content
    const content = await Bun.file(file).text()

    // Apply transforms
    const { result, replacements } = applyExtensionTransforms(content, file, options.verbose)

    // Write back if changed
    if (replacements > 0) {
      await Bun.write(file, result)
      await $`git add ${file}`.quiet().nothrow()
    }

    success(`Transformed extension ${file}: ${replacements} replacements`)
    return { file, action: "transformed", replacements, dryRun: false }
  } catch (err) {
    warn(`Failed to transform extension ${file}: ${err}`)
    return { file, action: "failed", replacements: 0, dryRun: false }
  }
}

/**
 * Transform conflicted extension files
 */
export async function transformConflictedExtensions(
  files: string[],
  options: ExtensionTransformOptions = {},
): Promise<ExtensionTransformResult[]> {
  const results: ExtensionTransformResult[] = []

  for (const file of files) {
    if (!isExtensionFile(file)) {
      debug(`Skipping ${file} - not an extension file`)
      results.push({ file, action: "skipped", replacements: 0, dryRun: options.dryRun ?? false })
      continue
    }

    const result = await transformExtensionFile(file, options)
    results.push(result)
  }

  return results
}

/**
 * Transform all extension files (pre-merge, on opencode branch)
 */
export async function transformAllExtensions(
  options: ExtensionTransformOptions = {},
): Promise<ExtensionTransformResult[]> {
  const { Glob } = await import("bun")
  const results: ExtensionTransformResult[] = []
  const patterns = defaultConfig.extensionFiles

  for (const pattern of patterns) {
    const glob = new Glob(pattern)

    for await (const path of glob.scan({ absolute: false })) {
      const file = Bun.file(path)
      if (!(await file.exists())) continue

      // Skip non-text files
      if (!path.endsWith(".toml") && !path.endsWith(".json") && !path.endsWith(".ts") && !path.endsWith(".js")) {
        continue
      }

      try {
        const content = await file.text()
        const { result, replacements } = applyExtensionTransforms(content, path, options.verbose)

        if (replacements > 0 && !options.dryRun) {
          await Bun.write(path, result)
          success(`Transformed extension ${path}: ${replacements} replacements`)
        } else if (options.dryRun && replacements > 0) {
          info(`[DRY-RUN] Would transform extension ${path}: ${replacements} replacements`)
        }

        results.push({ file: path, action: "transformed", replacements, dryRun: options.dryRun ?? false })
      } catch (err) {
        warn(`Failed to transform extension ${path}: ${err}`)
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
    info("Usage: transform-extensions.ts [--dry-run] [--verbose] <file1> <file2> ...")
    process.exit(1)
  }

  if (dryRun) {
    info("Running in dry-run mode")
  }

  const results = await transformConflictedExtensions(files, { dryRun, verbose })

  const transformed = results.filter((r) => r.action === "transformed")
  const total = results.reduce((sum, r) => sum + r.replacements, 0)

  console.log()
  success(`Transformed ${transformed.length} extension files with ${total} replacements`)

  if (dryRun) {
    info("Run without --dry-run to apply changes")
  }
}
