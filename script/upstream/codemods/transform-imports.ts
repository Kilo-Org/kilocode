#!/usr/bin/env bun
/**
 * jscodeshift codemod: Transform import statements
 *
 * Transforms imports from opencode packages to kilo packages:
 * - opencode-ai -> @kilocode/cli
 * - @opencode-ai/cli -> @kilocode/cli
 * - @opencode-ai/sdk -> @kilocode/sdk
 * - @opencode-ai/plugin -> @kilocode/plugin
 *
 * Usage with jscodeshift:
 *   npx jscodeshift -t script/upstream/codemods/transform-imports.ts src/
 *
 * Usage with ts-morph (standalone):
 *   bun run script/upstream/codemods/transform-imports.ts [files...]
 */

import { Project, SyntaxKind, type SourceFile } from "ts-morph"
import { Glob } from "bun"
import { info, success, warn } from "../utils/logger"
import { defaultConfig } from "../utils/config"

const IMPORT_MAPPINGS: Record<string, string> = {
  "opencode-ai": "@kilocode/cli",
  "@opencode-ai/cli": "@kilocode/cli",
  "@opencode-ai/sdk": "@kilocode/sdk",
  "@opencode-ai/plugin": "@kilocode/plugin",
}

/**
 * Get the transformed module specifier, handling subpaths.
 * Examples:
 *   "@opencode-ai/sdk" -> "@kilocode/sdk"
 *   "@opencode-ai/sdk/v2" -> "@kilocode/sdk/v2"
 *   "@opencode-ai/sdk/v2/client" -> "@kilocode/sdk/v2/client"
 */
function getTransformedModule(specifier: string): string | undefined {
  // Check exact match first
  if (IMPORT_MAPPINGS[specifier]) {
    return IMPORT_MAPPINGS[specifier]
  }

  // Check for subpath imports (e.g., @opencode-ai/sdk/v2)
  for (const [from, to] of Object.entries(IMPORT_MAPPINGS)) {
    if (specifier.startsWith(from + "/")) {
      return to + specifier.slice(from.length)
    }
  }

  return undefined
}

export interface TransformResult {
  file: string
  changes: number
}

/**
 * Transform imports in a single source file using ts-morph
 */
export function transformImports(sourceFile: SourceFile): number {
  let changes = 0

  // Transform import declarations
  const imports = sourceFile.getImportDeclarations()
  for (const imp of imports) {
    const moduleSpecifier = imp.getModuleSpecifierValue()
    const newModule = getTransformedModule(moduleSpecifier)

    if (newModule) {
      imp.setModuleSpecifier(newModule)
      changes++
    }
  }

  // Transform export declarations with from clause
  const exports = sourceFile.getExportDeclarations()
  for (const exp of exports) {
    const moduleSpecifier = exp.getModuleSpecifierValue()
    if (moduleSpecifier) {
      const newModule = getTransformedModule(moduleSpecifier)
      if (newModule) {
        exp.setModuleSpecifier(newModule)
        changes++
      }
    }
  }

  // Transform dynamic imports: import("opencode-ai")
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
  for (const call of callExpressions) {
    const expression = call.getExpression()
    if (expression.getKind() === SyntaxKind.ImportKeyword) {
      const args = call.getArguments()
      if (args.length > 0) {
        const arg = args[0]
        if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
          const value = arg.getText().slice(1, -1) // Remove quotes
          const newModule = getTransformedModule(value)
          if (newModule) {
            arg.replaceWithText(`"${newModule}"`)
            changes++
          }
        }
      }
    }
  }

  // Transform require calls
  for (const call of callExpressions) {
    const expression = call.getExpression()
    if (expression.getText() === "require") {
      const args = call.getArguments()
      if (args.length > 0) {
        const arg = args[0]
        if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
          const value = arg.getText().slice(1, -1)
          const newModule = getTransformedModule(value)
          if (newModule) {
            arg.replaceWithText(`"${newModule}"`)
            changes++
          }
        }
      }
    }
  }

  return changes
}

/**
 * Transform all TypeScript/JavaScript files in the project
 */
export async function transformAllImports(
  patterns: string[] = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
  dryRun = false,
): Promise<TransformResult[]> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
  })

  const results: TransformResult[] = []
  const excludes = defaultConfig.excludePatterns

  for (const pattern of patterns) {
    const glob = new Glob(pattern)

    for await (const path of glob.scan({ absolute: true })) {
      // Skip excluded paths
      if (excludes.some((ex) => path.includes(ex.replace(/\*\*/g, "")))) {
        continue
      }

      const sourceFile = project.addSourceFileAtPath(path)
      const changes = transformImports(sourceFile)

      if (changes > 0) {
        results.push({ file: path, changes })

        if (!dryRun) {
          await sourceFile.save()
          success(`Transformed ${path}: ${changes} import(s)`)
        } else {
          info(`[DRY-RUN] Would transform ${path}: ${changes} import(s)`)
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
  const files = args.filter((a) => !a.startsWith("--"))

  if (dryRun) {
    info("Running in dry-run mode")
  }

  const patterns = files.length > 0 ? files : undefined
  const results = await transformAllImports(patterns, dryRun)

  console.log()
  success(`Transformed ${results.length} files`)
  const totalChanges = results.reduce((sum, r) => sum + r.changes, 0)
  info(`Total imports transformed: ${totalChanges}`)
}
