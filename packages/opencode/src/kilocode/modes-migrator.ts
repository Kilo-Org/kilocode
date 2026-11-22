import matter from "gray-matter"
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import type { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"
import { ConfigPermissionV1 as ConfigPermission } from "@opencode-ai/core/v1/config/permission"
import { KilocodePaths } from "./paths"
import { regexToGlobs } from "./permission-glob"
import { pattern } from "./mcp/tool-id"
import type { OrganizationMode } from "@kilocode/kilo-gateway"

export namespace ModesMigrator {
  /** Options a legacy group tuple can carry. Any other key means the group was not read fully. */
  export interface GroupOptions {
    fileRegex?: string
    description?: string
    [key: string]: unknown
  }

  // Kilocode mode structure
  export interface KilocodeMode {
    slug: string
    name: string
    roleDefinition: string
    /**
     * A group is a name or a (name, options) pair. The YAML parser also leaves the options of a
     * pair as a standalone mapping item, so a bare `GroupOptions` can appear in the list and
     * carries the options of the plain name just before it.
     */
    groups: Array<string | GroupOptions | [string, GroupOptions]>
    customInstructions?: string
    whenToUse?: string
    description?: string
    source?: "global" | "project" | "organization"
  }

  export interface KilocodeModesFile {
    customModes: KilocodeMode[]
  }

  // Default modes to skip - these have native Opencode equivalents
  const DEFAULT_MODE_SLUGS = new Set(["code", "build", "architect", "ask", "debug", "orchestrator"])

  // Group to permission mapping
  const GROUP_TO_PERMISSION: Record<string, string> = {
    read: "read",
    edit: "edit",
    browser: "browser_open",
    command: "bash",
  }

  // All permissions that should be explicitly set (deny if not in groups)
  const ALL_PERMISSIONS = ["read", "edit", "bash", "browser_open"]

  /** Option keys a legacy group can carry. */
  const KNOWN_OPTIONS = /^(fileRegex|description)$/

  /**
   * Reported for an `mcp` group when a global store this load did not read declared servers:
   * the group can cover only the servers that were loaded, so it is incomplete even when some
   * server was migrated. Distinct from {@link MCP_NO_SERVER} because the cause is the skipped
   * store, not a migration that converted nothing.
   */
  const MCP_SKIPPED_GLOBAL = "MCP access incomplete: a global store this load did not read declared MCP servers"

  /** Reported for an `mcp` group when a store this load read declared a server none of them converted. */
  const MCP_NO_SERVER = "MCP access not migrated: no MCP server was migrated"

  export function isDefaultMode(slug: string): boolean {
    return DEFAULT_MODE_SLUGS.has(slug)
  }

  /**
   * Convert legacy mode groups to CLI permissions.
   *
   * `mcpServers` names the MCP servers the same migration wrote to `mcp`, so an `mcp`
   * group can grant their tools; there is no `mcp` permission key in the CLI.
   * `mcpAvailable` reports whether a store this run read declared any MCP server, not whether
   * one was converted: a store that declared a server the migration could not convert
   * still warns instead of silently dropping the `mcp` group.
   * `mcpSkippedGlobal` reports whether a global store this run did not read declared at
   * least one MCP server; such an `mcp` group is incomplete whatever else was migrated.
   */
  export function convertPermissions(
    groups: KilocodeMode["groups"],
    mcpServers: string[],
    mcpAvailable: boolean,
    mcpSkippedGlobal = false,
  ): ConfigPermission.Info {
    return convertWithMessages(groups, mcpServers, mcpAvailable, mcpSkippedGlobal).permission
  }

  type Restriction = Record<string, ConfigPermission.Action>

  /**
   * A `groups` entry the YAML parser left as a bare options mapping. `["edit", { fileRegex }]`
   * parses as the two items `"edit"` and `{ fileRegex }`, so such a mapping is never a group of
   * its own: it carries the options of the plain name just before it.
   */
  function isOptions(group: unknown): group is GroupOptions {
    return typeof group === "object" && group != null && !Array.isArray(group)
  }

  function isRestriction(rule: ConfigPermission.Rule | undefined): rule is Restriction {
    return rule != null && typeof rule === "object"
  }

  /** Strength of a rule when a mode writes the same key twice: ask keeps a prompt, a restriction keeps its files. */
  function rank(rule: ConfigPermission.Rule): number {
    if (rule === "ask") return 2
    if (isRestriction(rule)) return 1
    return 0
  }

  function sameRule(a: ConfigPermission.Rule, b: ConfigPermission.Rule): boolean {
    if (!isRestriction(a) || !isRestriction(b)) return a === b
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
  }

  /**
   * Merge a rule for a permission key a later group writes again. A mode that lists the same
   * group more than once keeps the narrower rule and reports the repeat in the warnings.
   */
  function mergeRule(
    key: string,
    existing: ConfigPermission.Rule | undefined,
    next: ConfigPermission.Rule,
    warnings: string[],
  ): ConfigPermission.Rule {
    if (existing == null) return next
    if (sameRule(existing, next)) return existing

    let winner: ConfigPermission.Rule
    if (isRestriction(existing) && isRestriction(next)) {
      winner = "ask"
    } else {
      winner = rank(next) > rank(existing) ? next : existing
    }

    if (winner === "ask") warnings.push(`Repeated group; ${key} set to ask`)
    else if (isRestriction(winner)) warnings.push(`Repeated group; ${key} kept its file restriction`)
    return winner
  }

  /** Convert legacy mode groups to CLI permissions, with the warnings they produced. */
  export function convertWithMessages(
    groups: KilocodeMode["groups"],
    mcpServers: string[],
    mcpAvailable: boolean,
    mcpSkippedGlobal = false,
  ): { permission: ConfigPermission.Info; warnings: string[] } {
    const permission: Record<string, ConfigPermission.Rule> = {}
    const allowed = new Set<string>()
    const warnings: string[] = []
    let seen = false

    for (let index = 0; index < groups.length; index++) {
      const group = groups[index]
      // A bare mapping is consumed with the plain name before it, never as a group of its own.
      if (isOptions(group)) continue
      const name = typeof group === "string" ? group : Array.isArray(group) ? group[0] : undefined
      if (typeof name !== "string") continue
      const next = groups[index + 1]
      // The YAML parser writes the options of a pair as their own item, so a mapping right after
      // a plain name is that name's options. They cannot be read as a group, and the grant must
      // narrow to a prompt: an allow here would widen a file restriction to the whole workspace.
      const carried = typeof group === "string" && isOptions(next) ? next : undefined
      const opts = carried ?? (Array.isArray(group) ? group[1] : undefined)
      const unknown = carried != null || (opts != null && Object.keys(opts).some((key) => !KNOWN_OPTIONS.test(key)))

      if (name === "mcp") {
        seen = true
        // The skipped store comes first: it makes the group incomplete even when this load
        // migrated servers, and it subsumes the empty case when nothing was migrated.
        if (mcpSkippedGlobal) {
          warnings.push(MCP_SKIPPED_GLOBAL)
          if (mcpServers.length === 0) continue
        } else if (mcpServers.length === 0) {
          if (mcpAvailable) warnings.push(MCP_NO_SERVER)
          continue
        }
        let action: ConfigPermission.Action = "allow"
        if (unknown) {
          warnings.push("Group options not migrated; mcp set to ask")
          action = "ask"
        } else if (opts?.fileRegex != null) {
          warnings.push(`File restriction not migrated; mcp set to ask: ${opts.fileRegex}`)
          action = "ask"
        }
        for (const server of mcpServers) {
          const key = pattern(server)
          allowed.add(key)
          permission[key] = mergeRule(key, permission[key], action, warnings)
        }
        continue
      }

      const permKey = GROUP_TO_PERMISSION[name]
      if (permKey == null) {
        warnings.push(`Group not migrated; "${name}" ignored`)
        continue
      }

      if (unknown) {
        warnings.push(`Group options not migrated; ${permKey} set to ask`)
        allowed.add(permKey)
        permission[permKey] = mergeRule(permKey, permission[permKey], "ask", warnings)
        continue
      }

      let value: ConfigPermission.Rule = "allow"
      const regex = opts?.fileRegex
      if (regex != null) {
        const globs = regexToGlobs(regex)
        if (globs == null) {
          warnings.push(`File restriction not migrated; ${permKey} set to ask: ${regex}`)
          value = "ask"
        } else {
          // Deny first: the CLI resolves the last matching rule, so the allows come after.
          value = { "*": "deny", ...Object.fromEntries(globs.map((glob) => [glob, "allow"])) }
        }
      }
      allowed.add(permKey)
      permission[permKey] = mergeRule(permKey, permission[permKey], value, warnings)
    }

    // Explicitly deny each mapped permission the mode did not grant: the CLI defaults a missing
    // permission to "ask", which would prompt for every call instead of refusing it.
    for (const perm of ALL_PERMISSIONS) {
      if (allowed.has(perm)) continue
      permission[perm] = "deny"
    }

    if (!seen) {
      for (const server of mcpServers) {
        const key = pattern(server)
        if (!allowed.has(key)) permission[key] = "deny"
      }
    }

    return { permission, warnings }
  }

  /**
   * Convert one legacy mode. The MCP arguments carry the two separate facts of the load:
   * `mcpAvailable` for a store this run read that declared a server none converted, and
   * `mcpSkippedGlobal` for a global store this run did not read that declared servers.
   */
  export function convertMode(
    mode: KilocodeMode,
    mcpServers: string[],
    mcpAvailable: boolean,
    mcpSkippedGlobal = false,
  ): ConfigAgentV1.Info {
    return build(mode, mcpServers, mcpAvailable, mcpSkippedGlobal).agent
  }

  /** {@link convertMode} with the warnings the conversion produced. */
  function build(
    mode: KilocodeMode,
    mcpServers: string[],
    mcpAvailable: boolean,
    mcpSkippedGlobal = false,
  ): { agent: ConfigAgentV1.Info; warnings: string[] } {
    const converted = convertWithMessages(mode.groups, mcpServers, mcpAvailable, mcpSkippedGlobal)

    return {
      agent: {
        mode: "primary",
        description: mode.description ?? mode.whenToUse ?? mode.name,
        prompt: [mode.roleDefinition, mode.customInstructions].filter(Boolean).join("\n\n"),
        permission: converted.permission,
      },
      warnings: converted.warnings,
    }
  }

  /**
   * Convert a cloud OrganizationMode to a ConfigAgentV1.Info.
   * Unlike legacy convertMode(), this does NOT skip default slugs —
   * organization admins can intentionally override built-in agents.
   */
  export function convertOrganizationMode(mode: OrganizationMode): { agent: ConfigAgentV1.Info; notes: string[] } {
    const cfg = mode.config
    const prompt = [cfg.roleDefinition, cfg.customInstructions].filter(Boolean).join("\n\n")
    const groups = cfg.groups ?? []
    if (groups.length === 0) {
      console.warn(
        `[ModesMigrator] Organization mode "${mode.slug}" has no groups configured — all tool permissions will be denied`,
      )
    }

    // An organization mode arrives from the cloud API before the project MCP config is
    // merged, and the CLI keys MCP tools per server, so the group cannot name them here.
    const notes: string[] = []
    if (groups.some((group) => (typeof group === "string" ? group : group?.[0]) === "mcp")) {
      notes.push("MCP access is not scoped to this agent: no MCP servers are attached at config load")
    }

    return {
      agent: {
        mode: "primary",
        description: cfg.description ?? cfg.whenToUse ?? mode.name,
        prompt: prompt || undefined,
        // An organization mode has no legacy MCP store, so no server-key grant applies.
        permission: convertPermissions(groups, [], false),
        // Typed metadata fields — must NOT live in `options`, which is forwarded to the provider.
        displayName: mode.name,
        source: "organization",
      },
      notes,
    }
  }

  /**
   * Convert an array of cloud OrganizationModes to a ConfigAgentV1.Info record
   * keyed by slug. All modes are included (no default-slug filtering).
   */
  export function convertOrganizationModes(modes: OrganizationMode[]): {
    agents: Record<string, ConfigAgentV1.Info>
    notes: Array<{ slug: string; message: string }>
  } {
    const agents: Record<string, ConfigAgentV1.Info> = {}
    const notes: Array<{ slug: string; message: string }> = []
    for (const mode of modes) {
      const converted = convertOrganizationMode(mode)
      agents[mode.slug] = converted.agent
      notes.push(...converted.notes.map((message) => ({ slug: mode.slug, message })))
    }
    return { agents, notes }
  }

  export async function readModesFile(filepath: string): Promise<KilocodeMode[]> {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      // Wrap YAML content in frontmatter delimiters so gray-matter can parse it
      const wrapped = `---\n${content}\n---`
      const parsed = matter(wrapped).data as KilocodeModesFile
      return parsed?.customModes ?? []
    } catch (err: any) {
      if (err.code === "ENOENT") return []
      throw err
    }
  }

  export interface MigrationResult {
    agents: Record<string, ConfigAgentV1.Info>
    skipped: Array<{ slug: string; reason: string }>
    /** Each message names the file the mode came from, so a caller can report it. */
    warnings: Array<{ path: string; message: string }>
  }

  export async function migrate(options: {
    projectDir: string
    globalSettingsDir?: string
    /** Skip reading from global paths (VSCode storage, home dir). Used for testing. */
    skipGlobalPaths?: boolean
    /** Names of the MCP servers the same migration writes, so an `mcp` group can grant their tools. */
    mcpServers?: string[]
    /**
     * Whether a store this run read declared any MCP server, converted or not: a store that
     * declared a server the migration could not convert still warns instead of silently
     * dropping the `mcp` group.
     */
    mcpAvailable: boolean
    /**
     * Whether a global MCP store this run did not read declared at least one server. That store
     * is never loaded, so an `mcp` group can cover only what this run migrated and is reported
     * as incomplete - independently of `mcpAvailable`, which concerns stores this run read.
     */
    mcpSkippedGlobal?: boolean
  }): Promise<MigrationResult> {
    const result: MigrationResult = {
      agents: {},
      skipped: [],
      warnings: [],
    }

    // Collect modes from all sources, each with the file it came from so a migration
    // warning can name that file instead of the project directory.
    const allModes: Array<{ mode: KilocodeMode; source: string }> = []
    const load = async (file: string) => {
      const modes = await readModesFile(file)
      allModes.push(...modes.map((mode) => ({ mode, source: file })))
    }

    if (!options.skipGlobalPaths) {
      // 1. VSCode extension global storage (primary location for global modes)
      await load(path.join(KilocodePaths.vscodeGlobalStorage(), "settings", "custom_modes.yaml"))

      // 2. CLI global settings (fallback/alternative location)
      await load(path.join(os.homedir(), ".kilocode", "cli", "global", "settings", "custom_modes.yaml"))

      // 3. Home directory .kilocodemodes
      const homeModesPath = path.join(os.homedir(), ".kilocodemodes")
      if (homeModesPath !== options.projectDir) await load(homeModesPath)
    }

    // 4. Legacy/explicit global settings dir (for backwards compatibility and testing)
    if (options.globalSettingsDir) {
      await load(path.join(options.globalSettingsDir, "custom_modes.yaml"))
    }

    // 5. Project .kilocodemodes
    await load(path.join(options.projectDir, ".kilocodemodes"))

    // Deduplicate by slug (later entries win)
    const modesBySlug = new Map<string, { mode: KilocodeMode; source: string }>()
    for (const entry of allModes) {
      modesBySlug.set(entry.mode.slug, entry)
    }

    const mcpServers = options.mcpServers ?? []

    // Process each mode
    for (const [slug, entry] of modesBySlug) {
      const mode = entry.mode
      // Skip default modes - let Opencode's native agents handle these
      if (isDefaultMode(slug)) {
        result.skipped.push({
          slug,
          reason: "Default mode - using Opencode native agent instead",
        })
        continue
      }

      // Migrate custom mode
      const converted = build(mode, mcpServers, options.mcpAvailable, options.mcpSkippedGlobal ?? false)
      result.agents[slug] = converted.agent
      result.warnings.push(
        ...converted.warnings.map((warning) => ({ path: entry.source, message: `Mode '${slug}': ${warning}` })),
      )
    }

    return result
  }
}
