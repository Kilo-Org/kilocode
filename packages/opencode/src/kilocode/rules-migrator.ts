import * as fs from "fs/promises"
import * as path from "path"
import os from "os"

export namespace RulesMigrator {
  // Only support .kilocoderules (no migration for .roorules or .clinerules)
  const LEGACY_RULE_FILE = ".kilocoderules"
  const home = () => process.env.KILO_TEST_HOME || process.env.HOME || process.env.USERPROFILE || os.homedir()

  // Directory-based rules (read from both .kilo and .kilocode)
  const KILO_RULES_DIRS = [".kilo/rules", ".kilocode/rules"]
  const globalRulesDirs = () => [path.join(home(), ".kilo", "rules"), path.join(home(), ".kilocode", "rules")]

  // Known modes for mode-specific rule discovery
  const KNOWN_MODES = ["code", "architect", "ask", "debug", "orchestrator"]

  export interface RuleFile {
    path: string
    source: "global" | "project" | "legacy"
    mode?: string // e.g., "code", "architect" - undefined means applies to all modes
  }

  export interface MigrationResult {
    instructions: string[]
    warnings: string[]
  }

  async function exists(filepath: string): Promise<boolean> {
    return Bun.file(filepath).exists()
  }

  async function isDirectory(filepath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filepath)
      return stat.isDirectory()
    } catch {
      return false
    }
  }

  async function findMarkdownFiles(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => path.join(dir, e.name))
    } catch {
      return []
    }
  }

  export async function discoverRules(projectDir: string): Promise<RuleFile[]> {
    const rules: RuleFile[] = []

    // 1. Global rules directories (~/.kilo/rules/*.md and ~/.kilocode/rules/*.md)
    const globalSeen = new Set<string>()
    for (const dir of globalRulesDirs()) {
      if (!(await isDirectory(dir))) continue
      const files = await findMarkdownFiles(dir)
      for (const file of files) {
        const name = path.basename(file)
        if (globalSeen.has(name)) continue
        globalSeen.add(name)
        rules.push({ path: file, source: "global" })
      }
    }

    // 2. Project .kilo/rules/ and .kilocode/rules/ directories
    const seen = new Set<string>()
    for (const rulesRel of KILO_RULES_DIRS) {
      const projectRulesDir = path.join(projectDir, rulesRel)
      if (await isDirectory(projectRulesDir)) {
        const files = await findMarkdownFiles(projectRulesDir)
        for (const file of files) {
          const name = path.basename(file)
          if (!seen.has(name)) {
            seen.add(name)
            rules.push({ path: file, source: "project" })
          }
        }
      }
    }

    // 3. Legacy .kilocoderules file (only kilocode, not roo/cline)
    const legacyFile = path.join(projectDir, LEGACY_RULE_FILE)
    if (await exists(legacyFile)) {
      rules.push({ path: legacyFile, source: "legacy" })
    }

    // 4. Mode-specific rules
    for (const mode of KNOWN_MODES) {
      // Mode-specific directories (.kilo/rules-{mode}/*.md and .kilocode/rules-{mode}/*.md)
      const modeSeen = new Set<string>()
      for (const prefix of [".kilo", ".kilocode"]) {
        const modeDir = path.join(projectDir, `${prefix}/rules-${mode}`)
        if (await isDirectory(modeDir)) {
          const files = await findMarkdownFiles(modeDir)
          for (const file of files) {
            const name = path.basename(file)
            if (!modeSeen.has(name)) {
              modeSeen.add(name)
              rules.push({ path: file, source: "project", mode })
            }
          }
        }
      }

      // Legacy mode-specific file (.kilocoderules-{mode})
      const legacyModeFile = path.join(projectDir, `.kilocoderules-${mode}`)
      if (await exists(legacyModeFile)) {
        rules.push({ path: legacyModeFile, source: "legacy", mode })
      }
    }

    return rules
  }

  export async function migrate(options: {
    projectDir: string
    includeGlobal?: boolean
    includeModeSpecific?: boolean
  }): Promise<MigrationResult> {
    const warnings: string[] = []
    const instructions: string[] = []
    const includeGlobal = options.includeGlobal ?? true
    const includeModeSpecific = options.includeModeSpecific ?? true

    const rules = await discoverRules(options.projectDir)

    for (const rule of rules) {
      // Skip global if not requested
      if (rule.source === "global" && !includeGlobal) {
        continue
      }

      // Skip mode-specific if not requested
      if (rule.mode && !includeModeSpecific) {
        warnings.push(`Mode-specific rule '${path.basename(rule.path)}' skipped (mode: ${rule.mode})`)
        continue
      }

      // Add to instructions array
      instructions.push(rule.path)

      // Warn about legacy files
      if (rule.source === "legacy") {
        warnings.push(
          `Legacy rule file '${path.basename(rule.path)}' found. Consider migrating to .kilo/rules/ directory.`,
        )
      }
    }

    return { instructions, warnings }
  }
}
