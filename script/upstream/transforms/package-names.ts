#!/usr/bin/env bun
/**
 * Transform package names from opencode to kilo
 *
 * This script transforms:
 * - opencode-ai -> @kilocode/cli
 * - @opencode-ai/cli -> @kilocode/cli
 * - @opencode-ai/sdk -> @kilocode/sdk
 * - @opencode-ai/plugin -> @kilocode/plugin
 */

import { Glob } from "bun"
import { info, success, warn, debug } from "../utils/logger"
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
]

/**
 * Transform package names in a single file
 */
export async function transformFile(filePath: string, options: TransformOptions = {}): Promise<TransformResult> {
  const file = Bun.file(filePath)
  let content = await file.text()
  const original = content
  let changes = 0

  for (const { pattern, replacement } of PACKAGE_PATTERNS) {
    const regex = typeof pattern === "string" ? new RegExp(pattern, "g") : pattern
    const newContent = content.replace(regex, replacement)
    if (newContent !== content) {
      const count = (content.match(regex) || []).length
      changes += count
      content = newContent
    }
  }

  if (changes > 0 && !options.dryRun) {
    await Bun.write(filePath, content)
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
