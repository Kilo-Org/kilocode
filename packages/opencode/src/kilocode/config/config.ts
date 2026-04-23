// kilocode_change - new file
import path from "path"
import { pathToFileURL } from "url"
import { existsSync } from "fs"
import z from "zod"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"
import { mergeDeep } from "remeda"
import { Log } from "../../util"
import { Global } from "../../global"
import { NamedError } from "@opencode-ai/shared/util/error"
import { Bus } from "@/bus"
import { isRecord } from "@/util/record"
import { ConfigError } from "../../config/error"
import { Filesystem } from "@/util"
import type { Config } from "../../config"
import type { ConfigAgent } from "../../config"
import { ModesMigrator } from "../modes-migrator"
import { fetchOrganizationModes } from "@kilocode/kilo-gateway"
import { RulesMigrator } from "../rules-migrator"
import { WorkflowsMigrator } from "../workflows-migrator"
import { McpMigrator } from "../mcp-migrator"
import { IgnoreMigrator } from "../ignore-migrator"

export namespace KilocodeConfig {
  const log = Log.create({ service: "kilocode.config" })

  // ── Config schema extensions ─────────────────────────────────────────

  /** Schema for AI-generated commit message configuration. */
  export const CommitMessageSchema = z
    .object({
      prompt: z
        .string()
        .optional()
        .describe(
          "Custom system prompt for AI commit message generation. When set, replaces the default conventional commits prompt entirely.",
        ),
    })
    .optional()
    .describe("Configuration for AI-generated commit messages")

  // ── Config file constants ────────────────────────────────────────────

  /** Kilo-specific config file names (highest-to-lowest precedence within kilo). */
  export const KILO_CONFIG_FILES = ["kilo.jsonc", "kilo.json"] as const

  /** All config file names in precedence order (kilo + opencode). */
  export const ALL_CONFIG_FILES = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"] as const

  /** Directory suffixes that Kilo recognizes in addition to .opencode. */
  export const KILO_DIR_SUFFIXES = [".kilo", ".kilocode"] as const

  /** Path patterns for resolving kilo agent names from file paths. */
  export const AGENT_PATTERNS = ["/.kilo/agent/", "/.kilo/agents/", "/.kilocode/agent/", "/.kilocode/agents/"] as const

  /** Path patterns for resolving kilo command names from file paths. */
  export const COMMAND_PATTERNS = [
    "/.kilo/command/",
    "/.kilo/commands/",
    "/.kilocode/command/",
    "/.kilocode/commands/",
  ] as const

  // ── Warning helpers ──────────────────────────────────────────────────

  /** Convert known config-loading error types into a Warning.  Returns undefined for unknown errors. */
  export function toWarning(err: unknown): Config.Warning | undefined {
    if (ConfigError.JsonError.isInstance(err))
      return {
        path: err.data.path,
        message: `Config file at ${err.data.path} is not valid JSON(C)`,
        detail: err.data.message || undefined,
      }
    if (ConfigError.InvalidError.isInstance(err)) {
      const text = err.data.issues ? formatIssues(err.data.issues) : err.data.message
      return {
        path: err.data.path,
        message: text
          ? `Configuration is invalid at ${err.data.path}: ${text}`
          : `Configuration is invalid at ${err.data.path}`,
      }
    }
    return undefined
  }

  /** Format Zod issues into a human-readable string. */
  export function formatIssues(issues: z.core.$ZodIssue[]) {
    return issues
      .map((issue) => {
        const loc = issue.path.map(String).join(".")
        if (!loc) return issue.message
        return `${loc}: ${issue.message}`
      })
      .join("\n")
  }

  /** Handle an invalid agent/command config: log, publish session error, collect warning. */
  export async function handleInvalid(
    kind: "agent" | "command",
    item: string,
    issues: z.core.$ZodIssue[],
    cause: Error,
    warnings?: Config.Warning[],
  ) {
    const text = formatIssues(issues)
    const message = text ? `Config file at ${item} is invalid: ${text}` : `Config file at ${item} is invalid`
    const err = new ConfigError.InvalidError({ path: item, issues }, { cause })
    if (warnings) warnings.push({ path: item, message, detail: text || undefined })
    try {
      const { Session } = await import("@/session")
      Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
    } catch (e) {
      log.warn("could not publish session error", { message, err: e })
    }
    if (kind === "command") {
      log.error("failed to load command", { command: item, err, message })
      return
    }
    log.error("failed to load agent", { agent: item, err, message })
  }

  /**
   * Try running a callback. If it throws a known config error, convert to a
   * warning and push it into the array. Unknown errors are re-thrown.
   */
  export function caught(warnings: Config.Warning[], source: string, err: unknown) {
    const w = toWarning(err)
    if (w) {
      warnings.push(w)
      log.warn("skipped config due to error", { source, err })
      return
    }
    throw err
  }

  // ── Legacy config loading ────────────────────────────────────────────

  type MergeFn = (target: Config.Info, source: Config.Info) => Config.Info

  /**
   * Load all Kilocode legacy configs (modes, workflows, rules, MCP, ignore).
   * These have the lowest precedence in the config chain.
   */
  export async function loadLegacyConfigs(input: {
    projectDir: string
    merge: MergeFn
  }): Promise<{ config: Config.Info; warnings: Config.Warning[] }> {
    const warnings: Config.Warning[] = []
    let result: Config.Info = {}

    // Load Kilocode custom modes
    try {
      const migration = await ModesMigrator.migrate({ projectDir: input.projectDir })
      if (Object.keys(migration.agents).length > 0) {
        result = input.merge(result, { agent: migration.agents })
        log.debug("loaded kilocode custom modes", {
          count: Object.keys(migration.agents).length,
          modes: Object.keys(migration.agents),
        })
      }
      for (const skipped of migration.skipped) {
        log.debug("skipped kilocode mode", { slug: skipped.slug, reason: skipped.reason })
      }
    } catch (err) {
      log.warn("failed to load kilocode modes", { error: err })
    }

    // Load Kilocode workflows as commands
    try {
      const migration = await WorkflowsMigrator.migrate({ projectDir: input.projectDir })
      if (Object.keys(migration.commands).length > 0) {
        result = input.merge(result, { command: migration.commands })
        log.debug("loaded kilocode workflows as commands", {
          count: Object.keys(migration.commands).length,
          commands: Object.keys(migration.commands),
        })
      }
    } catch (err) {
      log.warn("failed to load kilocode workflows", { error: err })
    }

    // Load Kilocode rules
    try {
      const migration = await RulesMigrator.migrate({ projectDir: input.projectDir })
      if (migration.instructions.length > 0) {
        result = input.merge(result, { instructions: migration.instructions })
        log.debug("loaded kilocode rules", {
          count: migration.instructions.length,
          files: migration.instructions,
        })
      }
      for (const warning of migration.warnings) {
        log.debug("kilocode rules warning", { warning })
      }
    } catch (err) {
      log.warn("failed to load kilocode rules", { error: err })
    }

    // Load Kilocode MCP servers (skip global VSCode extension paths unless running in the extension)
    const skipGlobal = process.env["KILO_PLATFORM"] !== "vscode"
    const mcp = await McpMigrator.loadMcpConfig(input.projectDir, skipGlobal)
    if (Object.keys(mcp).length > 0) {
      result = input.merge(result, { mcp })
    }

    // Load .kilocodeignore patterns
    try {
      const permission = await IgnoreMigrator.loadIgnoreConfig(input.projectDir)
      if (Object.keys(permission).length > 0) {
        result = input.merge(result, { permission })
        log.debug("loaded kilocode ignore patterns", {
          hasRead: !!(permission as Record<string, unknown>).read,
          hasEdit: !!(permission as Record<string, unknown>).edit,
        })
      }
    } catch (err) {
      log.warn("failed to load kilocode ignore patterns", { error: err })
    }

    return { config: result, warnings }
  }

  // ── Organization modes ───────────────────────────────────────────────

  /**
   * Load organization custom modes from the Kilo Cloud API.
   * Returns empty agents + warnings if the user is not authenticated.
   */
  export async function loadOrganizationModes(
    auth: Record<string, any>,
  ): Promise<{ agents: Record<string, ConfigAgent.Info>; warnings: Config.Warning[] }> {
    const warnings: Config.Warning[] = []
    try {
      const kilo = auth["kilo"]
      if (kilo?.type === "oauth" && kilo.access && kilo.accountId) {
        const modes = await fetchOrganizationModes(kilo.access, kilo.accountId)
        if (modes.length > 0) {
          const agents = ModesMigrator.convertOrganizationModes(modes)
          log.debug("loaded organization custom modes", {
            count: modes.length,
            modes: modes.map((m: any) => m.slug),
          })
          return { agents, warnings }
        }
      }
    } catch (err) {
      log.warn("failed to load organization custom modes", { error: err })
    }
    return { agents: {}, warnings }
  }

  // ── Bash permission migration ────────────────────────────────────────

  const GLOBAL_CONFIG_FILES = ["config.json", "kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc"]

  /**
   * Migrate bash permission for existing users before config is consumed.
   *
   * Existing users (those with at least one global config file or the legacy TOML
   * config) who have no explicit `permission.bash` setting get `bash: "allow"`
   * written to their highest-precedence config file. This preserves their current
   * behavior now that the new default is `bash: "ask"`.
   */
  export async function migrateBashPermission() {
    const files = GLOBAL_CONFIG_FILES.map((f) => path.join(Global.Path.config, f))
    const legacy = path.join(Global.Path.config, "config")
    const existing = files.filter((f) => existsSync(f))
    const hasLegacy = existsSync(legacy)

    // no global config → new user, they'll get the new bash:ask default
    if (existing.length === 0 && !hasLegacy) return

    // check if any config file already has an explicit bash permission
    for (const file of existing) {
      const text = await Bun.file(file)
        .text()
        .catch(() => "")
      const data = parseJsonc(text) ?? {}
      if (data.permission?.bash) return
    }

    // also check legacy TOML config for bash permission
    if (hasLegacy) {
      const toml = await import(pathToFileURL(legacy).href, { with: { type: "toml" } }).catch(() => undefined)
      if (toml?.default?.permission?.bash) return
    }

    // existing user without bash permission → write bash:allow to highest-precedence file
    const target = existing.length > 0 ? existing[existing.length - 1] : path.join(Global.Path.config, "config.json")
    const text = await Bun.file(target)
      .text()
      .catch(() => "{}")

    if (target.endsWith(".jsonc")) {
      const edits = modify(text, ["permission", "bash"], "allow", {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      })
      await Bun.write(target, applyEdits(text, edits))
      log.info("migrated bash permission to allow for existing user", { path: target })
      return
    }

    const data = parseJsonc(text) ?? {}
    const merged = { ...data, permission: { ...data.permission, bash: "allow" } }
    await Bun.write(target, JSON.stringify(merged, null, 2))
    log.info("migrated bash permission to allow for existing user", { path: target })
  }

  // ── Config merge utilities ───────────────────────────────────────────

  /** Recursively remove null values and drop objects left empty after removal. */
  export function stripNulls(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (value === null) continue
      if (isRecord(value)) {
        const stripped = stripNulls(value)
        if (Object.keys(stripped).length > 0) result[key] = stripped
      } else {
        result[key] = value
      }
    }
    return result
  }

  /**
   * Merge a patch into an existing config:
   * 1. Normalize permission scalars → objects when the patch has an object
   *    (e.g. existing `"bash": "ask"` + patch `"bash": { "npm *": "allow" }`
   *    → promotes existing to `"bash": { "*": "ask" }` so mergeDeep works)
   * 2. Deep-merge
   * 3. Strip null delete sentinels
   */
  export function mergeConfig(existing: Config.Info, patch: Config.Info): Config.Info {
    const e = { ...existing } as Record<string, unknown>
    const p = patch as Record<string, unknown>

    // Normalize permission scalars before merge
    const existingPerm = e.permission
    const patchPerm = p.permission
    if (isRecord(existingPerm) && isRecord(patchPerm)) {
      const cloned = { ...existingPerm }
      for (const [key, value] of Object.entries(patchPerm)) {
        const existing = cloned[key]
        if (typeof existing === "string" && isRecord(value)) {
          cloned[key] = { "*": existing }
        }
      }
      e.permission = cloned
    }

    return stripNulls(mergeDeep(e, p) as Record<string, unknown>) as Config.Info
  }

  // ── Directory check helper ───────────────────────────────────────────

  /** Check whether a directory path should be treated as a config directory (for loading config files). */
  export function isConfigDir(dir: string, flagDir?: string): boolean {
    return dir.endsWith(".kilo") || dir.endsWith(".kilocode") || dir.endsWith(".opencode") || dir === flagDir
  }
}
