#!/usr/bin/env bun
/**
 * ts-morph codemod: transform import and require statements to Kilo package names.
 *
 * Module mappings come from `config.packageMappings`. The codemod is gated by `transforms.packageNames`
 * and only reports changes by default; pass `--apply` to write them.
 *
 * Usage: bun run script/upstream/codemods/transform-imports.ts [--apply] [--force] [files...]
 */

import { Project, SyntaxKind, type Node, type SourceFile } from "ts-morph"
import { Glob } from "bun"
import { info, success, error } from "../utils/logger"
import { defaultConfig } from "../utils/config"

export interface ImportChange {
  file: string
  line: number
  before: string
  after: string
}

export interface TransformResult {
  file: string
  changes: ImportChange[]
}

const IMPORT_MAPPINGS: Record<string, string> = Object.fromEntries(
  defaultConfig.packageMappings.map((mapping) => [mapping.from, mapping.to]),
)

/**
 * Get the transformed module specifier, handling subpaths.
 * Examples:
 *   "@opencode/sdk" -> "@kilocode/sdk"
 *   "@opencode/sdk/v2" -> "@kilocode/sdk/v2"
 *   "@opencode/sdk/v2/client" -> "@kilocode/sdk/v2/client"
 */
function getTransformedModule(specifier: string): string | undefined {
  if (IMPORT_MAPPINGS[specifier]) return IMPORT_MAPPINGS[specifier]

  for (const [from, to] of Object.entries(IMPORT_MAPPINGS)) {
    if (specifier.startsWith(from + "/")) return to + specifier.slice(from.length)
  }

  return undefined
}

function record(changes: ImportChange[], file: string, node: Node, before: string, after: string): void {
  changes.push({ file, line: node.getStartLineNumber(), before, after })
}

/**
 * Transform imports in a single source file and return the changes it made.
 */
export function transformImports(sourceFile: SourceFile): ImportChange[] {
  const file = sourceFile.getFilePath()
  const changes: ImportChange[] = []

  for (const imp of sourceFile.getImportDeclarations()) {
    const before = imp.getModuleSpecifierValue()
    const after = getTransformedModule(before)
    if (!after) continue
    record(changes, file, imp, before, after)
    imp.setModuleSpecifier(after)
  }

  for (const exp of sourceFile.getExportDeclarations()) {
    const before = exp.getModuleSpecifierValue()
    if (!before) continue
    const after = getTransformedModule(before)
    if (!after) continue
    record(changes, file, exp, before, after)
    exp.setModuleSpecifier(after)
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression()
    const dynamicImport = expression.getKind() === SyntaxKind.ImportKeyword
    if (!dynamicImport && expression.getText() !== "require") continue

    const arg = call.getArguments()[0]
    if (!arg || arg.getKind() !== SyntaxKind.StringLiteral) continue

    const before = arg.getText().slice(1, -1)
    const after = getTransformedModule(before)
    if (!after) continue
    record(changes, file, arg, before, after)
    arg.replaceWithText(`"${after}"`)
  }

  return changes
}

/**
 * Transform all TypeScript/JavaScript files matching the patterns.
 */
export async function transformAllImports(
  patterns: string[] = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
  apply = false,
): Promise<TransformResult[]> {
  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const results: TransformResult[] = []
  const excludes = defaultConfig.excludePatterns

  for (const pattern of patterns) {
    const glob = new Glob(pattern)

    for await (const path of glob.scan({ absolute: true })) {
      // Package renames apply to Kilo-owned code too, or Kilo imports of a renamed package break.
      if (excludes.some((ex) => path.includes(ex.replace(/\*\*/g, "")))) continue

      const sourceFile = project.addSourceFileAtPath(path)
      const changes = transformImports(sourceFile)
      if (changes.length === 0) continue

      results.push({ file: path, changes })
      if (apply) {
        await sourceFile.save()
        success(`Transformed ${path}: ${changes.length} import(s)`)
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

  // Import specifiers are package names: they follow D-1 (`transforms.packageNames`), not branding.
  if (apply && !defaultConfig.transforms.packageNames && !force) {
    error("Import codemod is off in the v2 config (transforms.packageNames); pass --force to apply")
    process.exit(1)
  }

  const results = await transformAllImports(files.length > 0 ? files : undefined, apply)

  for (const result of results) {
    for (const change of result.changes) {
      console.log(`${change.file}:${change.line}: ${change.before} -> ${change.after}`)
    }
  }

  const total = results.reduce((sum, result) => sum + result.changes.length, 0)
  console.log()
  success(`${apply ? "Transformed" : "Would transform"} ${results.length} files, ${total} import(s)`)
  if (!apply) info("Run with --apply to write changes")
}
