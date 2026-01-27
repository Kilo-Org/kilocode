// kilocode_change - new file

import * as path from "path"
import os from "os"
import { Log } from "../util/log"
import type { Config } from "../config/config"

export namespace IgnoreMigrator {
  const log = Log.create({ service: "kilocode.ignore-migrator" })

  const KILOCODEIGNORE_FILE = ".kilocodeignore"
  const GLOBAL_KILOCODEIGNORE = path.join(os.homedir(), ".kilocode", KILOCODEIGNORE_FILE)

  export interface IgnorePattern {
    pattern: string
    negated: boolean
    source: "global" | "project"
  }

  export interface MigrationResult {
    permission: Config.Permission
    warnings: string[]
    patternCount: number
  }

  async function fileExists(filepath: string): Promise<boolean> {
    return Bun.file(filepath).exists()
  }

  /**
   * Parse .kilocodeignore content into patterns.
   * Follows gitignore syntax:
   * - Lines starting with # are comments
   * - Empty lines are ignored
   * - Lines starting with ! are negation patterns
   */
  export function parseIgnoreContent(content: string): Array<{ pattern: string; negated: boolean }> {
    const patterns: Array<{ pattern: string; negated: boolean }> = []

    for (const line of content.split("\n")) {
      const trimmed = line.trim()

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) continue

      // Handle negation patterns
      if (trimmed.startsWith("!")) {
        patterns.push({ pattern: trimmed.slice(1), negated: true })
      } else {
        patterns.push({ pattern: trimmed, negated: false })
      }
    }

    return patterns
  }

  /**
   * Convert gitignore pattern to Opencode wildcard pattern.
   *
   * Opencode's Wildcard module uses simple patterns:
   * - `*` matches any characters (converted to `.*` regex)
   * - `?` matches single character
   *
   * Gitignore semantics we need to handle:
   * - `foo/` matches directory and all contents -> `foo/*`
   * - `*.env` matches anywhere in tree -> `*.env` (already works)
   * - `/foo` matches only at root -> `foo` (rooted)
   * - `foo` matches anywhere -> `*foo*` or just `foo` depending on context
   *
   * Note: Opencode's wildcard `*` already matches any path depth because
   * it's converted to `.*` regex which matches `/` characters.
   */
  export function convertToGlob(pattern: string): string {
    let glob = pattern

    // Directory patterns (ending with /) should match all contents
    if (glob.endsWith("/")) {
      glob = glob.slice(0, -1) + "/*"
    }

    // Patterns starting with / are rooted - remove the leading /
    if (glob.startsWith("/")) {
      glob = glob.slice(1)
    }

    // Remove **/ prefix if present - Opencode's * already matches paths
    if (glob.startsWith("**/")) {
      glob = "*" + glob.slice(3)
    }

    // Replace **/ in the middle with just *
    glob = glob.replace(/\*\*\//g, "*")

    // Replace trailing /** with /*
    if (glob.endsWith("/**")) {
      glob = glob.slice(0, -3) + "/*"
    }

    return glob
  }

  /**
   * Load patterns from a .kilocodeignore file
   */
  async function loadIgnoreFile(filepath: string, source: "global" | "project"): Promise<IgnorePattern[]> {
    if (!(await fileExists(filepath))) return []

    const content = await Bun.file(filepath).text()
    const parsed = parseIgnoreContent(content)

    return parsed.map((p) => ({
      pattern: p.pattern,
      negated: p.negated,
      source,
    }))
  }

  /**
   * Build permission rules from ignore patterns.
   *
   * Order matters! Patterns are evaluated in order:
   * 1. Start with "*": "allow" (default allow)
   * 2. Add deny patterns
   * 3. Add negated patterns (allow) last to override denies
   */
  export function buildPermissionRules(patterns: IgnorePattern[]): Record<string, Config.PermissionAction> {
    const rules: Record<string, Config.PermissionAction> = {
      "*": "allow", // Default: allow all
    }

    // First pass: add deny rules
    for (const p of patterns) {
      if (!p.negated) {
        const glob = convertToGlob(p.pattern)
        rules[glob] = "deny"
      }
    }

    // Second pass: add negated (allow) rules - these override denies
    for (const p of patterns) {
      if (p.negated) {
        const glob = convertToGlob(p.pattern)
        rules[glob] = "allow"
      }
    }

    return rules
  }

  /**
   * Migrate .kilocodeignore to Opencode permission config
   */
  export async function migrate(options: { projectDir: string; skipGlobalPaths?: boolean }): Promise<MigrationResult> {
    const warnings: string[] = []
    const allPatterns: IgnorePattern[] = []

    // 1. Load global .kilocodeignore (lower priority)
    if (!options.skipGlobalPaths) {
      const globalPatterns = await loadIgnoreFile(GLOBAL_KILOCODEIGNORE, "global")
      allPatterns.push(...globalPatterns)

      if (globalPatterns.length > 0) {
        log.debug("loaded global .kilocodeignore", { count: globalPatterns.length })
      }
    }

    // 2. Load project .kilocodeignore (higher priority - added last)
    const projectIgnorePath = path.join(options.projectDir, KILOCODEIGNORE_FILE)
    const projectPatterns = await loadIgnoreFile(projectIgnorePath, "project")
    allPatterns.push(...projectPatterns)

    if (projectPatterns.length > 0) {
      log.debug("loaded project .kilocodeignore", { count: projectPatterns.length })
    }

    // 3. Build permission rules
    if (allPatterns.length === 0) {
      return {
        permission: {},
        warnings,
        patternCount: 0,
      }
    }

    const rules = buildPermissionRules(allPatterns)

    // 4. Create permission config for both read and edit
    const permission: Config.Permission = {
      read: rules,
      edit: rules,
    }

    return {
      permission,
      warnings,
      patternCount: allPatterns.length,
    }
  }

  /**
   * Load .kilocodeignore and return permission config.
   * Handles all logging internally.
   */
  export async function loadIgnoreConfig(projectDir: string, skipGlobalPaths?: boolean): Promise<Config.Permission> {
    try {
      const result = await migrate({ projectDir, skipGlobalPaths })

      if (result.patternCount > 0) {
        log.info("loaded .kilocodeignore patterns", {
          count: result.patternCount,
        })
      }

      for (const warning of result.warnings) {
        log.warn("ignore migration warning", { warning })
      }

      return result.permission
    } catch (err) {
      log.warn("failed to load .kilocodeignore", { error: err })
      return {}
    }
  }
}
