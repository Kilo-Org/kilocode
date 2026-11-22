import { Config } from "../config/config"
import { ConfigPermissionV1 as ConfigPermission } from "@opencode-ai/core/v1/config/permission"
import { ModesMigrator } from "./modes-migrator"
import { McpMigrator } from "./mcp-migrator"
import { RulesMigrator } from "./rules-migrator"
import { WorkflowsMigrator } from "./workflows-migrator"
import { IgnoreMigrator } from "./ignore-migrator"

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

    // A migrated mode's `mcp` group grants the tools of every server the same migration
    // converted, whether its entry came from a project file or a global store: the legacy
    // group meant all MCP tools. The live CLI loader grants the same set, so both loaders
    // follow this one rule. One pass only. The injector asks for nothing beyond the paths this
    // call reads, so `skipGlobalPaths` here stays hermetic: the skipped-store report is the
    // live loader's, which reads the same global stores for the modes themselves.
    const store = await McpMigrator.loadMcpConfig(options.projectDir, options.skipGlobalPaths)

    // Migrate custom modes
    const modesMigration = await ModesMigrator.migrate({
      projectDir: options.projectDir,
      globalSettingsDir: options.globalSettingsDir,
      skipGlobalPaths: options.skipGlobalPaths,
      mcpServers: Object.keys(store.mcp),
      mcpAvailable: store.available,
    })

    // Log skipped default modes and mode migration warnings (for debugging)
    for (const skipped of modesMigration.skipped) {
      warnings.push(`Mode '${skipped.slug}' skipped: ${skipped.reason}`)
    }
    warnings.push(...modesMigration.warnings.map((warning) => warning.message))

    if (Object.keys(modesMigration.agents).length > 0) {
      config.agent = modesMigration.agents
    }

    // Migrate workflows to commands
    const workflowsMigration = await WorkflowsMigrator.migrate(options)

    warnings.push(...workflowsMigration.warnings)

    if (Object.keys(workflowsMigration.commands).length > 0) {
      config.command = workflowsMigration.commands
    }

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

    return {
      configJson: JSON.stringify(config),
      warnings,
    }
  }

  /**
   * Merge permission configs, preserving order and handling duplicates.
   * Incoming rules take precedence (kilocode patterns override).
   */
  function mergePermissions(
    existing: ConfigPermission.Info | undefined,
    incoming: ConfigPermission.Info,
  ): ConfigPermission.Info {
    if (!existing) return incoming

    const result: ConfigPermission.Info = { ...existing }

    for (const [key, value] of Object.entries(incoming)) {
      if (key === "read" || key === "edit") {
        const existingRules = (result[key] as Record<string, ConfigPermission.Action>) ?? {}
        const incomingRules = value as Record<string, ConfigPermission.Action>
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
      KILO_CONFIG_CONTENT: configJson,
    }
  }
}
