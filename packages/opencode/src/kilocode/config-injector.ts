import { Config } from "../config/config"
import { ModesMigrator } from "./modes-migrator"
import { RulesMigrator } from "./rules-migrator" // kilocode_change
import { WorkflowsMigrator } from "./workflows-migrator"
import { IgnoreMigrator } from "./ignore-migrator" // kilocode_change

export namespace KilocodeConfigInjector {
  export interface InjectionResult {
    configJson: string
    warnings: string[]
  }

  export async function buildConfig(options: {
    projectDir: string
    globalSettingsDir?: string
    /** Skip reading from global paths (VSCode storage, home dir). Used for testing. */
    skipGlobalPaths?: boolean
    /** Include rules migration. Defaults to true. */
    includeRules?: boolean
    /** Include ignore migration. Defaults to true. */
    includeIgnore?: boolean
  }): Promise<InjectionResult> {
    const warnings: string[] = []

    // Build config object
    const config: Partial<Config.Info> = {}

    // Migrate custom modes
    const modesMigration = await ModesMigrator.migrate(options)

    // Log skipped default modes (for debugging)
    for (const skipped of modesMigration.skipped) {
      warnings.push(`Mode '${skipped.slug}' skipped: ${skipped.reason}`)
    }

    if (Object.keys(modesMigration.agents).length > 0) {
      config.agent = modesMigration.agents
    }

    // Migrate workflows to commands
    const workflowsMigration = await WorkflowsMigrator.migrate(options)

    warnings.push(...workflowsMigration.warnings)

    if (Object.keys(workflowsMigration.commands).length > 0) {
      config.command = workflowsMigration.commands
    }

    // kilocode_change start - Rules migration
    if (options.includeRules !== false) {
      const rulesMigration = await RulesMigrator.migrate({
        projectDir: options.projectDir,
        includeGlobal: !options.skipGlobalPaths,
        includeModeSpecific: true,
      })

      warnings.push(...rulesMigration.warnings)

      if (rulesMigration.instructions.length > 0) {
        config.instructions = rulesMigration.instructions
      }
    }
    // kilocode_change end

    // kilocode_change start - Ignore migration
    if (options.includeIgnore !== false) {
      const ignoreMigration = await IgnoreMigrator.migrate({
        projectDir: options.projectDir,
        skipGlobalPaths: options.skipGlobalPaths,
      })

      warnings.push(...ignoreMigration.warnings)

      if (Object.keys(ignoreMigration.permission).length > 0) {
        config.permission = mergePermissions(config.permission, ignoreMigration.permission)
      }
    }
    // kilocode_change end

    return {
      configJson: JSON.stringify(config),
      warnings,
    }
  }

  /**
   * Merge permission configs, preserving order and handling duplicates.
   * Incoming rules take precedence (kilocode patterns override).
   */
  function mergePermissions(existing: Config.Permission | undefined, incoming: Config.Permission): Config.Permission {
    if (!existing) return incoming

    const result: Config.Permission = { ...existing }

    for (const [key, value] of Object.entries(incoming)) {
      if (key === "read" || key === "edit") {
        const existingRules = (result[key] as Record<string, Config.PermissionAction>) ?? {}
        const incomingRules = value as Record<string, Config.PermissionAction>
        result[key] = { ...existingRules, ...incomingRules }
      } else {
        result[key] = value
      }
    }

    return result
  }

  export function getEnvVars(configJson: string): Record<string, string> {
    if (!configJson || configJson === "{}") {
      return {}
    }
    return {
      OPENCODE_CONFIG_CONTENT: configJson,
    }
  }
}
