#!/usr/bin/env bun
/**
 * Transform Tauri/Desktop config files with Kilo branding
 *
 * This script handles Tauri configuration files (JSON, TOML, Rust) by:
 * 1. Taking upstream's version as the base
 * 2. Applying predictable Kilo branding transforms
 *
 * Handles:
 * - tauri.conf.json / tauri.prod.conf.json
 * - Cargo.toml / Cargo.lock
 * - Rust source files (*.rs)
 */

import { $ } from "bun"
import { info, success, warn, debug } from "../utils/logger"
import { defaultConfig } from "../utils/config"

export interface TauriTransformResult {
  file: string
  action: "transformed" | "skipped" | "failed"
  replacements: number
  dryRun: boolean
}

export interface TauriTransformOptions {
  dryRun?: boolean
  verbose?: boolean
}

interface TauriReplacement {
  pattern: RegExp
  replacement: string
  description: string
  fileTypes?: string[] // Only apply to these file extensions
}

// Tauri-specific replacements
const TAURI_REPLACEMENTS: TauriReplacement[] = [
  // JSON config - product names
  {
    pattern: /"productName":\s*"OpenCode[^"]*"/g,
    replacement: '"productName": "Kilo"',
    description: "Product name in JSON",
    fileTypes: [".json"],
  },
  {
    pattern: /"title":\s*"OpenCode[^"]*"/g,
    replacement: '"title": "Kilo"',
    description: "Title in JSON",
    fileTypes: [".json"],
  },

  // JSON config - identifiers
  {
    pattern: /ai\.opencode\.desktop\.dev/g,
    replacement: "ai.kilo.desktop.dev",
    description: "Dev identifier",
  },
  {
    pattern: /ai\.opencode\.desktop/g,
    replacement: "ai.kilo.desktop",
    description: "Prod identifier",
  },

  // Binary names
  {
    pattern: /opencode-cli/g,
    replacement: "kilo-cli",
    description: "CLI binary name",
  },
  {
    pattern: /"mainBinaryName":\s*"[Oo]pen[Cc]ode"/g,
    replacement: '"mainBinaryName": "Kilo"',
    description: "Main binary name",
    fileTypes: [".json"],
  },

  // GitHub references
  {
    pattern: /github\.com\/anomalyco\/opencode/g,
    replacement: "github.com/Kilo-Org/kilo",
    description: "GitHub URL",
  },
  {
    pattern: /anomalyco\/opencode/g,
    replacement: "Kilo-Org/kilo",
    description: "GitHub repo",
  },

  // Cargo.toml specific
  {
    pattern: /name\s*=\s*"opencode-desktop"/g,
    replacement: 'name = "kilo-desktop"',
    description: "Cargo package name",
    fileTypes: [".toml"],
  },
  {
    pattern: /authors\s*=\s*\["OpenCode"\]/g,
    replacement: 'authors = ["Kilo"]',
    description: "Cargo authors",
    fileTypes: [".toml"],
  },
  {
    pattern: /name\s*=\s*"opencode_lib"/g,
    replacement: 'name = "kilo_lib"',
    description: "Cargo lib name",
    fileTypes: [".toml"],
  },

  // Rust source specific
  {
    pattern: /opencode\.settings\.dat/g,
    replacement: "kilo.settings.dat",
    description: "Settings file name",
    fileTypes: [".rs"],
  },
  {
    pattern: /"\.opencode\/bin"/g,
    replacement: '".kilo/bin"',
    description: "CLI install dir",
    fileTypes: [".rs"],
  },
  {
    pattern: /CLI_BINARY_NAME\s*=\s*"opencode"/g,
    replacement: 'CLI_BINARY_NAME = "kilo"',
    description: "CLI binary constant",
    fileTypes: [".rs"],
  },
  {
    pattern: /opencode_lib::run/g,
    replacement: "kilo_lib::run",
    description: "Lib run call",
    fileTypes: [".rs"],
  },
  {
    pattern: /killall opencode-cli/g,
    replacement: "killall kilo-cli",
    description: "Killall command",
    fileTypes: [".rs"],
  },

  // Domain
  {
    pattern: /opencode\.ai/g,
    replacement: "kilo.ai",
    description: "Domain",
  },

  // Environment variables (exclude OPENCODE_API_KEY)
  {
    pattern: /OPENCODE_(?!API_KEY)([A-Z_]+)/g,
    replacement: "KILO_$1",
    description: "Env variable",
    fileTypes: [".rs"],
  },
  {
    pattern: /__OPENCODE__/g,
    replacement: "__KILO__",
    description: "Window global",
    fileTypes: [".rs", ".tsx"],
  },
  {
    pattern: /OPENCODE_PORT/g,
    replacement: "KILO_PORT",
    description: "Port env var",
  },
]

/**
 * Check if a file is a Tauri config file
 */
export function isTauriFile(file: string): boolean {
  const patterns = defaultConfig.tauriFiles

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
 * Apply Tauri-specific transforms to content
 */
export function applyTauriTransforms(
  content: string,
  file: string,
  verbose = false,
): { result: string; replacements: number } {
  const ext = getExtension(file)
  let result = content
  let total = 0

  for (const { pattern, replacement, description, fileTypes } of TAURI_REPLACEMENTS) {
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
 * Transform a single Tauri file
 */
export async function transformTauriFile(
  file: string,
  options: TauriTransformOptions = {},
): Promise<TauriTransformResult> {
  if (options.dryRun) {
    info(`[DRY-RUN] Would transform Tauri file: ${file}`)
    return { file, action: "transformed", replacements: 0, dryRun: true }
  }

  try {
    // Take upstream's version first
    await $`git checkout --theirs ${file}`.quiet().nothrow()
    await $`git add ${file}`.quiet().nothrow()

    // Read content
    const content = await Bun.file(file).text()

    // Apply transforms
    const { result, replacements } = applyTauriTransforms(content, file, options.verbose)

    // Write back if changed
    if (replacements > 0) {
      await Bun.write(file, result)
      await $`git add ${file}`.quiet().nothrow()
    }

    success(`Transformed Tauri file ${file}: ${replacements} replacements`)
    return { file, action: "transformed", replacements, dryRun: false }
  } catch (err) {
    warn(`Failed to transform Tauri file ${file}: ${err}`)
    return { file, action: "failed", replacements: 0, dryRun: false }
  }
}

/**
 * Transform conflicted Tauri files
 */
export async function transformConflictedTauri(
  files: string[],
  options: TauriTransformOptions = {},
): Promise<TauriTransformResult[]> {
  const results: TauriTransformResult[] = []

  for (const file of files) {
    if (!isTauriFile(file)) {
      debug(`Skipping ${file} - not a Tauri file`)
      results.push({ file, action: "skipped", replacements: 0, dryRun: options.dryRun ?? false })
      continue
    }

    const result = await transformTauriFile(file, options)
    results.push(result)
  }

  return results
}

/**
 * Transform all Tauri files (pre-merge, on opencode branch)
 */
export async function transformAllTauri(options: TauriTransformOptions = {}): Promise<TauriTransformResult[]> {
  const { Glob } = await import("bun")
  const results: TauriTransformResult[] = []
  const patterns = defaultConfig.tauriFiles

  for (const pattern of patterns) {
    const glob = new Glob(pattern)

    for await (const path of glob.scan({ absolute: false })) {
      const file = Bun.file(path)
      if (!(await file.exists())) continue

      try {
        const content = await file.text()
        const { result, replacements } = applyTauriTransforms(content, path, options.verbose)

        if (replacements > 0 && !options.dryRun) {
          await Bun.write(path, result)
          success(`Transformed Tauri ${path}: ${replacements} replacements`)
        } else if (options.dryRun && replacements > 0) {
          info(`[DRY-RUN] Would transform Tauri ${path}: ${replacements} replacements`)
        }

        results.push({ file: path, action: "transformed", replacements, dryRun: options.dryRun ?? false })
      } catch (err) {
        warn(`Failed to transform Tauri ${path}: ${err}`)
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
    info("Usage: transform-tauri.ts [--dry-run] [--verbose] <file1> <file2> ...")
    process.exit(1)
  }

  if (dryRun) {
    info("Running in dry-run mode")
  }

  const results = await transformConflictedTauri(files, { dryRun, verbose })

  const transformed = results.filter((r) => r.action === "transformed")
  const total = results.reduce((sum, r) => sum + r.replacements, 0)

  console.log()
  success(`Transformed ${transformed.length} Tauri files with ${total} replacements`)

  if (dryRun) {
    info("Run without --dry-run to apply changes")
  }
}
