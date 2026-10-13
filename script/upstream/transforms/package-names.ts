#!/usr/bin/env bun
/**
 * Transform package names from upstream to Kilo names.
 *
 * Package names come from `config.packageMappings` and apply only when `transforms.packageNames` is on.
 * The legacy brand tokens (environment prefix, HTTP header prefix, database filename, window global)
 * stay here but apply only when `transforms.branding` is on too.
 */

import { Glob } from "bun"
import { info, success, error } from "../utils/logger"
import { defaultConfig, type MergeConfig, type PackageMapping } from "../utils/config"
import { isKiloOwned } from "../utils/owned"
import { relative } from "node:path"

export interface TransformResult {
  file: string
  changes: number
  dryRun: boolean
}

export interface TransformOptions {
  dryRun?: boolean
  verbose?: boolean
  force?: boolean
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

interface Pattern {
  pattern: RegExp
  replacement: string
}

/**
 * Package-name patterns derived from the configured mappings. The lookahead keeps subpath imports
 * (`@opencode/sdk/v2`), JSON keys, quotes, and line ends working, and stops a short name from
 * matching a longer package such as `@opencode/client`.
 */
function packagePatterns(mappings: PackageMapping[]): Pattern[] {
  return mappings.map(({ from, to }) => ({
    pattern: new RegExp(`${escapeRegExp(from)}(?=/|"|'|\`|$)`, "g"),
    replacement: to,
  }))
}

/** Legacy brand tokens, gated by `transforms.branding`. Kept only where the v2 tree still uses them. */
const BRAND_PATTERNS: Pattern[] = [
  { pattern: /\bOPENCODE_(?!API_KEY\b)([A-Z_]+)\b/g, replacement: "KILO_$1" },
  { pattern: /VITE_OPENCODE_/g, replacement: "VITE_KILO_" },
  { pattern: /_EXTENSION_OPENCODE_/g, replacement: "_EXTENSION_KILO_" },
  { pattern: /x-opencode-/g, replacement: "x-kilo-" },
  { pattern: /window\.__OPENCODE__/g, replacement: "window.__KILO__" },
  { pattern: /opencode\.db/g, replacement: "kilo.db" },
]

/**
 * Apply package name and brand transforms to content.
 */
export function applyPackageNameTransforms(
  input: string,
  config: MergeConfig = defaultConfig,
): { result: string; changes: number } {
  const patterns = [...packagePatterns(config.packageMappings), ...(config.transforms.branding ? BRAND_PATTERNS : [])]

  return patterns.reduce(
    (state, { pattern, replacement }) => {
      pattern.lastIndex = 0
      const count = (state.result.match(pattern) || []).length
      pattern.lastIndex = 0
      const result = state.result.replace(pattern, replacement)
      if (result === state.result) return state
      return { result, changes: state.changes + count }
    },
    { result: input, changes: 0 },
  )
}

/**
 * Transform package names in a single file.
 */
export async function transformFile(filePath: string, options: TransformOptions = {}): Promise<TransformResult> {
  const input = await Bun.file(filePath).text()
  const { result, changes } = applyPackageNameTransforms(input)

  if (changes > 0 && !options.dryRun) await Bun.write(filePath, result)

  return { file: filePath, changes, dryRun: options.dryRun ?? false }
}

/**
 * Transform package names in all relevant files.
 */
export async function transformAll(options: TransformOptions = {}): Promise<TransformResult[]> {
  if (!defaultConfig.transforms.packageNames && !options.force) {
    info("Package name transform is off in the v2 config (transforms.packageNames); pass --force to run it")
    return []
  }

  const results: TransformResult[] = []
  const patterns = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.json", "**/*.md"]
  const excludes = defaultConfig.excludePatterns

  for (const pattern of patterns) {
    const glob = new Glob(pattern)

    for await (const path of glob.scan({ absolute: true })) {
      // Kilo-owned paths are Kilo code: never rebrand them.
      if (isKiloOwned(relative(process.cwd(), path))) continue
      if (excludes.some((ex) => path.includes(ex.replace(/\*\*/g, "")))) continue

      const result = await transformFile(path, options)
      if (result.changes === 0) continue

      results.push(result)
      if (options.dryRun) {
        info(`[DRY-RUN] Would transform ${result.file}: ${result.changes} changes`)
      } else {
        success(`Transformed ${result.file}: ${result.changes} changes`)
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

  if (apply && !defaultConfig.transforms.packageNames && !force) {
    error("Package name transform is off in the v2 config (transforms.packageNames); pass --force to apply")
    process.exit(1)
  }

  const options = { dryRun: !apply, verbose, force }
  const results =
    files.length > 0 ? await Promise.all(files.map((file) => transformFile(file, options))) : await transformAll(options)

  const changed = results.filter((r) => r.changes > 0)
  for (const result of changed) console.log(`${result.file}: ${result.changes} replacement(s)`)

  console.log()
  success(apply ? `Transformed ${changed.length} files` : `Would transform ${changed.length} files`)

  if (!apply) info("Run with --apply to write changes")
}
