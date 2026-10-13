#!/usr/bin/env bun
/**
 * ts-morph codemod: transform string literals to Kilo branding.
 *
 * Package names come from `config.packageMappings` and follow `transforms.packageNames`; brand text
 * follows `transforms.branding`. The codemod only reports changes by default; pass `--apply` to write them.
 *
 * Limitation: the text inside template spans (`${x} text`) is not transformed, because a span has
 * no standalone replaceable node. Template heads and no-substitution templates are handled.
 *
 * Usage: bun run script/upstream/codemods/transform-strings.ts [--apply] [--force] [files...]
 */

import { Project, SyntaxKind, type Node, type SourceFile } from "ts-morph"
import { Glob } from "bun"
import { info, success, error } from "../utils/logger"
import { defaultConfig } from "../utils/config"
import { isKiloOwned } from "../utils/owned"
import { relative } from "node:path"

export interface StringChange {
  file: string
  line: number
  before: string
  after: string
}

export interface TransformResult {
  file: string
  changes: StringChange[]
}

interface StringReplacement {
  pattern: RegExp
  replacement: string
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Package names from the configured mappings. The lookahead keeps subpaths and quotes working.
const PACKAGE_REPLACEMENTS: StringReplacement[] = defaultConfig.packageMappings.map(({ from, to }) => ({
  pattern: new RegExp(`${escapeRegExp(from)}(?=/|"|'|\`|$)`, "g"),
  replacement: to,
}))

// Brand text (`transforms.branding`). Package names above follow `transforms.packageNames`.
const BRAND_REPLACEMENTS: StringReplacement[] = [
  // CLI commands
  { pattern: /\bnpx opencode\b/g, replacement: "npx @kilocode/cli" },

  // Database filename
  { pattern: /\bopencode\.db\b/g, replacement: "kilo.db" },

  // HTTP header prefix
  { pattern: /x-opencode-/g, replacement: "x-kilo-" },

  // Environment variables (exclude OPENCODE_API_KEY, the upstream Zen SaaS key)
  { pattern: /\bOPENCODE_(?!API_KEY\b)([A-Z_]+)\b/g, replacement: "KILO_$1" },
]

/** The rules for the enabled switches. The dry-run report uses both, to show what each would change. */
export function stringRules(input: { packages: boolean; brand: boolean }): StringReplacement[] {
  return [...(input.packages ? PACKAGE_REPLACEMENTS : []), ...(input.brand ? BRAND_REPLACEMENTS : [])]
}

const ALL = stringRules({ packages: true, brand: true })

function applyStringReplacements(value: string, rules: StringReplacement[]): { result: string; changed: boolean } {
  let result = value
  for (const { pattern, replacement } of rules) {
    pattern.lastIndex = 0
    result = result.replace(pattern, replacement)
  }
  return { result, changed: result !== value }
}

function visit(node: Node, file: string, changes: StringChange[], rules: StringReplacement[]): void {
  const before = node.getText()
  const { result, changed } = applyStringReplacements(before, rules)
  if (!changed) return
  changes.push({ file, line: node.getStartLineNumber(), before, after: result })
  node.replaceWithText(result)
}

/**
 * Transform string literals in a source file and return the changes it made.
 */
export function transformStrings(sourceFile: SourceFile, rules: StringReplacement[] = ALL): StringChange[] {
  const file = sourceFile.getFilePath()
  const changes: StringChange[] = []

  for (const literal of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) visit(literal, file, changes, rules)
  for (const template of sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    visit(template, file, changes, rules)
  }
  for (const head of sourceFile.getDescendantsOfKind(SyntaxKind.TemplateHead)) visit(head, file, changes, rules)

  return changes
}

/**
 * Transform all TypeScript/JavaScript files matching the patterns.
 */
export async function transformAllStrings(
  patterns: string[] = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
  apply = false,
  rules: StringReplacement[] = ALL,
): Promise<TransformResult[]> {
  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const results: TransformResult[] = []
  const excludes = defaultConfig.excludePatterns

  for (const pattern of patterns) {
    const glob = new Glob(pattern)

    for await (const path of glob.scan({ absolute: true })) {
      if (excludes.some((ex) => path.includes(ex.replace(/\*\*/g, "")))) continue
      // Kilo-owned code is never rebranded, but it follows package renames so its imports keep working.
      const fileRules = isKiloOwned(relative(process.cwd(), path))
        ? rules.filter((rule) => PACKAGE_REPLACEMENTS.includes(rule))
        : rules
      if (fileRules.length === 0) continue

      const sourceFile = project.addSourceFileAtPath(path)
      const changes = transformStrings(sourceFile, fileRules)
      if (changes.length === 0) continue

      results.push({ file: path, changes })
      if (apply) {
        await sourceFile.save()
        success(`Transformed ${path}: ${changes.length} string(s)`)
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
  const files = args.filter((a) => !a.startsWith("--"))

  // Apply only the rules whose switch is on. The report (no --apply) shows both.
  const packages = defaultConfig.transforms.packageNames || force
  const brand = defaultConfig.transforms.branding || force
  if (apply && !packages && !brand) {
    error("String codemod is off in the v2 config (transforms.packageNames, transforms.branding); pass --force to apply")
    process.exit(1)
  }

  const rules = apply ? stringRules({ packages, brand }) : ALL
  const results = await transformAllStrings(files.length > 0 ? files : undefined, apply, rules)

  for (const result of results) {
    for (const change of result.changes) {
      console.log(`${change.file}:${change.line}: ${change.before} -> ${change.after}`)
    }
  }

  const total = results.reduce((sum, result) => sum + result.changes.length, 0)
  console.log()
  success(`${apply ? "Transformed" : "Would transform"} ${results.length} files, ${total} string(s)`)
  if (!apply) info("Run with --apply to write changes")
}
