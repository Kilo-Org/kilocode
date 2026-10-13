#!/usr/bin/env bun
/**
 * Transform package names and branding from opencode to kilo
 *
 * This script transforms:
 * - opencode-ai -> @kilocode/cli
 * - @opencode-ai/cli -> @kilocode/cli
 * - @opencode-ai/sdk -> @kilocode/sdk
 * - @opencode-ai/plugin -> @kilocode/plugin
 * - OPENCODE_* -> KILO_* (env variables, excluding OPENCODE_API_KEY)
 * - x-opencode-* -> x-kilo-* (HTTP headers)
 * - opencode.db -> kilo.db (database filename)
 * - window.__OPENCODE__ -> window.__KILO__ (window global)
 */

import { Glob } from "bun"
import { info, success } from "../utils/logger"
import { defaultConfig } from "../utils/config"

export interface TransformResult {
  file: string
  changes: number
  dryRun: boolean
}

export interface TransformOptions {
  dryRun?: boolean
  verbose?: boolean
}

const PACKAGE_PATTERNS = [
  // In package.json name field
  { pattern: /"name":\s*"opencode-ai"/, replacement: '"name": "@kilocode/cli"' },
  { pattern: /"name":\s*"@opencode-ai\/cli"/, replacement: '"name": "@kilocode/cli"' },

  // In dependencies/devDependencies
  { pattern: /"opencode-ai":\s*"/g, replacement: '"@kilocode/cli": "' },
  { pattern: /"@opencode-ai\/cli":\s*"/g, replacement: '"@kilocode/cli": "' },
  { pattern: /"@opencode-ai\/sdk":\s*"/g, replacement: '"@kilocode/sdk": "' },
  { pattern: /"@opencode-ai\/plugin":\s*"/g, replacement: '"@kilocode/plugin": "' },

  // In any string context (mock.module, dynamic references, etc.)
  // Only cli, sdk, and plugin are renamed — other @opencode-ai/* packages
  // (e.g. @opencode-ai/ui, @opencode-ai/util) keep their upstream names.
  { pattern: /@opencode-ai\/cli(?=\/|"|'|`|$)/g, replacement: "@kilocode/cli" },
  { pattern: /@opencode-ai\/sdk(?=\/|"|'|`|$)/g, replacement: "@kilocode/sdk" },
  { pattern: /@opencode-ai\/plugin(?=\/|"|'|`|$)/g, replacement: "@kilocode/plugin" },

  // In import statements (supports subpaths like @opencode-ai/sdk/v2)
  { pattern: /from\s+["']opencode-ai["']/g, replacement: 'from "@kilocode/cli"' },
  { pattern: /from\s+["']@opencode-ai\/cli(\/[^"']*)?["']/g, replacement: 'from "@kilocode/cli$1"' },
  { pattern: /from\s+["']@opencode-ai\/sdk(\/[^"']*)?["']/g, replacement: 'from "@kilocode/sdk$1"' },
  { pattern: /from\s+["']@opencode-ai\/plugin(\/[^"']*)?["']/g, replacement: 'from "@kilocode/plugin$1"' },

  // In require statements (supports subpaths like @opencode-ai/sdk/v2)
  { pattern: /require\(["']opencode-ai["']\)/g, replacement: 'require("@kilocode/cli")' },
  { pattern: /require\(["']@opencode-ai\/cli(\/[^"']*)?["']\)/g, replacement: 'require("@kilocode/cli$1")' },
  { pattern: /require\(["']@opencode-ai\/sdk(\/[^"']*)?["']\)/g, replacement: 'require("@kilocode/sdk$1")' },
  { pattern: /require\(["']@opencode-ai\/plugin(\/[^"']*)?["']\)/g, replacement: 'require("@kilocode/plugin$1")' },

  // Internal placeholder hostname used for in-process RPC (never resolved by DNS)
  { pattern: /opencode\.internal/g, replacement: "kilo.internal" },

  // In npx/npm commands
  { pattern: /npx opencode-ai/g, replacement: "npx @kilocode/cli" },
  { pattern: /npm install opencode-ai/g, replacement: "npm install @kilocode/cli" },
  { pattern: /bun add opencode-ai/g, replacement: "bun add @kilocode/cli" },

  // SDK public API renames (Opencode → Kilo)
  // Order matters: longer names first to avoid partial matches
  { pattern: /OpencodeClientConfig/g, replacement: "KiloClientConfig" },
  { pattern: /createOpencodeClient/g, replacement: "createKiloClient" },
  { pattern: /createOpencodeServer/g, replacement: "createKiloServer" },
  { pattern: /createOpencodeTui/g, replacement: "createKiloTui" },
  { pattern: /OpencodeClient/g, replacement: "KiloClient" },
  // createOpencode (without suffix) needs negative lookahead to avoid matching createOpencodeClient
  { pattern: /\bcreateOpencode\b(?!Client|Server|Tui)/g, replacement: "createKilo" },

  // Branding: environment variables (exclude OPENCODE_API_KEY — upstream Zen SaaS key)
  { pattern: /\bOPENCODE_(?!API_KEY\b)([A-Z_]+)\b/g, replacement: "KILO_$1" },
  { pattern: /VITE_OPENCODE_/g, replacement: "VITE_KILO_" },
  { pattern: /_EXTENSION_OPENCODE_/g, replacement: "_EXTENSION_KILO_" },

  // Branding: HTTP header prefix
  { pattern: /x-opencode-/g, replacement: "x-kilo-" },

  // Branding: window global
  { pattern: /window\.__OPENCODE__/g, replacement: "window.__KILO__" },

  // Branding: database filename
  { pattern: /opencode\.db/g, replacement: "kilo.db" },
]

/**
 * Apply package name and branding transforms to content.
 */
export function applyPackageNameTransforms(input: string): { result: string; changes: number } {
  return PACKAGE_PATTERNS.reduce(
    (state, { pattern, replacement }) => {
      const regex = typeof pattern === "string" ? new RegExp(pattern, "g") : pattern
      regex.lastIndex = 0
      const count = (state.result.match(regex) || []).length
      regex.lastIndex = 0
      const result = state.result.replace(regex, replacement)
      if (result === state.result) return state
      return { result, changes: state.changes + count }
    },
    { result: input, changes: 0 },
  )
}

/**
 * Transform package names in a single file
 */
export async function transformFile(filePath: string, options: TransformOptions = {}): Promise<TransformResult> {
  const file = Bun.file(filePath)
  const input = await file.text()
  const { result, changes } = applyPackageNameTransforms(input)

  if (changes > 0 && !options.dryRun) {
    await Bun.write(filePath, result)
  }

  return {
    file: filePath,
    changes,
    dryRun: options.dryRun ?? false,
  }
}

/**
 * Transform package names in all relevant files
 */
export async function transformAll(options: TransformOptions = {}): Promise<TransformResult[]> {
  const results: TransformResult[] = []

  // Find all relevant files
  const patterns = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.json", "**/*.md"]

  const excludes = defaultConfig.excludePatterns

  for (const pattern of patterns) {
    const glob = new Glob(pattern)

    for await (const path of glob.scan({ absolute: true })) {
      // Skip excluded paths
      if (excludes.some((ex) => path.includes(ex.replace(/\*\*/g, "")))) {
        continue
      }

      const result = await transformFile(path, options)

      if (result.changes > 0) {
        results.push(result)

        if (options.dryRun) {
          info(`[DRY-RUN] Would transform ${result.file}: ${result.changes} changes`)
        } else {
          success(`Transformed ${result.file}: ${result.changes} changes`)
        }
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

  if (dryRun) {
    info("Running in dry-run mode (no files will be modified)")
  }

  const results = await transformAll({ dryRun, verbose })

  console.log()
  success(`Transformed ${results.length} files`)

  if (dryRun) {
    info("Run without --dry-run to apply changes")
  }
}
