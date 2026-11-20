import matter from "gray-matter"
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import type { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"
import { ConfigPermissionV1 as ConfigPermission } from "@opencode-ai/core/v1/config/permission"
import { KilocodePaths } from "./paths"
import { regexToGlobs } from "./permission-glob"
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
    groups: Array<string | [string, GroupOptions]>
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
  const ALL_PERMISSIONS = ["read", "edit", "bash", "browser_open", "skill"]

  /** Option keys a legacy group can carry. */
  const KNOWN_OPTIONS = /^(fileRegex|description)$/

  const UNSAFE_KEY = /[^a-zA-Z0-9_-]/g

  export function isDefaultMode(slug: string): boolean {
    return DEFAULT_MODE_SLUGS.has(slug)
  }

  /**
   * Convert legacy mode groups to CLI permissions.
   *
   * `mcpServers` names the MCP servers the same migration wrote to `mcp`, so an `mcp`
   * group can grant their tools; there is no `mcp` permission key in the CLI.
   */
  export function convertPermissions(groups: KilocodeMode["groups"], mcpServers: string[] = []): ConfigPermission.Info {
    return convert(groups, mcpServers).permission
  }

  function convert(
    groups: KilocodeMode["groups"],
    mcpServers: string[],
  ): { permission: ConfigPermission.Info; warnings: string[] } {
    const permission: Record<string, ConfigPermission.Rule> = {}
    const allowed = new Set<string>()
    const warnings: string[] = []
    let seen = false

    for (const group of groups) {
      const name = typeof group === "string" ? group : Array.isArray(group) ? group[0] : undefined
      if (typeof name !== "string") continue
      const opts = typeof group === "string" ? undefined : Array.isArray(group) ? group[1] : undefined
      const unknown = opts != null && Object.keys(opts).some((key) => !KNOWN_OPTIONS.test(key))

      if (name === "mcp") {
        seen = true
        if (mcpServers.length === 0) {
          warnings.push("MCP access not migrated: no MCP server was migrated")
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
          const key = `${server.replace(UNSAFE_KEY, "_")}_*`
          allowed.add(key)
          permission[key] = action
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
        permission[permKey] = "ask"
        continue
      }

      let value: ConfigPermission.Rule = "allow"
      const pattern = opts?.fileRegex
      if (pattern != null) {
        const globs = regexToGlobs(pattern)
        if (globs == null) {
          warnings.push(`File restriction not migrated; ${permKey} set to ask: ${pattern}`)
          value = "ask"
        } else {
          // Deny first: the CLI resolves the last matching rule, so the allows come after.
          value = { "*": "deny", ...Object.fromEntries(globs.map((glob) => [glob, "allow"])) }
        }
      }
      allowed.add(permKey)

      const existing = permission[permKey]
      if (existing == null) {
        permission[permKey] = value
        continue
      }
      if (existing === "allow" || value === "allow") {
        permission[permKey] = "allow"
        continue
      }
      if (typeof existing === "object" && existing !== null && typeof value === "object" && value !== null) {
        permission[permKey] = { ...existing, ...value }
        continue
      }
      permission[permKey] = value
    }

    // Explicitly deny permissions that aren't granted: the CLI defaults a missing
    // permission to "ask", which would prompt for every call instead of refusing it.
    for (const perm of ALL_PERMISSIONS) {
      if (!allowed.has(perm)) permission[perm] = "deny"
    }

    if (!seen) {
      for (const server of mcpServers) {
        const key = `${server.replace(UNSAFE_KEY, "_")}_*`
        if (!allowed.has(key)) permission[key] = "deny"
      }
    }

    return { permission, warnings }
  }

  export function convertMode(mode: KilocodeMode, mcpServers: string[] = []): ConfigAgentV1.Info {
    return build(mode, mcpServers).agent
  }

  function build(mode: KilocodeMode, mcpServers: string[]): { agent: ConfigAgentV1.Info; warnings: string[] } {
    const converted = convert(mode.groups, mcpServers)

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
  export function convertOrganizationMode(mode: OrganizationMode): ConfigAgentV1.Info {
    const cfg = mode.config
    const prompt = [cfg.roleDefinition, cfg.customInstructions].filter(Boolean).join("\n\n")
    const groups = cfg.groups ?? []
    if (groups.length === 0) {
      console.warn(
        `[ModesMigrator] Organization mode "${mode.slug}" has no groups configured — all tool permissions will be denied`,
      )
    }

    return {
      mode: "primary",
      description: cfg.description ?? cfg.whenToUse ?? mode.name,
      prompt: prompt || undefined,
      permission: convertPermissions(groups),
      // Typed metadata fields — must NOT live in `options`, which is forwarded to the provider.
      displayName: mode.name,
      source: "organization",
    }
  }

  /**
   * Convert an array of cloud OrganizationModes to a ConfigAgentV1.Info record
   * keyed by slug. All modes are included (no default-slug filtering).
   */
  export function convertOrganizationModes(modes: OrganizationMode[]): Record<string, ConfigAgentV1.Info> {
    const result: Record<string, ConfigAgentV1.Info> = {}
    for (const mode of modes) {
      result[mode.slug] = convertOrganizationMode(mode)
    }
    return result
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
    warnings: string[]
  }

  export async function migrate(options: {
    projectDir: string
    globalSettingsDir?: string
    /** Skip reading from global paths (VSCode storage, home dir). Used for testing. */
    skipGlobalPaths?: boolean
    /** Names of the MCP servers the same migration writes, so an `mcp` group can grant their tools. */
    mcpServers?: string[]
  }): Promise<MigrationResult> {
    const result: MigrationResult = {
      agents: {},
      skipped: [],
      warnings: [],
    }

    // Collect modes from all sources
    const allModes: KilocodeMode[] = []

    if (!options.skipGlobalPaths) {
      // 1. VSCode extension global storage (primary location for global modes)
      const vscodeGlobalPath = path.join(KilocodePaths.vscodeGlobalStorage(), "settings", "custom_modes.yaml")
      allModes.push(...(await readModesFile(vscodeGlobalPath)))

      // 2. CLI global settings (fallback/alternative location)
      const cliGlobalPath = path.join(os.homedir(), ".kilocode", "cli", "global", "settings", "custom_modes.yaml")
      allModes.push(...(await readModesFile(cliGlobalPath)))

      // 3. Home directory .kilocodemodes
      const homeModesPath = path.join(os.homedir(), ".kilocodemodes")
      if (homeModesPath !== options.projectDir) {
        allModes.push(...(await readModesFile(homeModesPath)))
      }
    }

    // 4. Legacy/explicit global settings dir (for backwards compatibility and testing)
    if (options.globalSettingsDir) {
      const legacyPath = path.join(options.globalSettingsDir, "custom_modes.yaml")
      allModes.push(...(await readModesFile(legacyPath)))
    }

    // 5. Project .kilocodemodes
    const projectModesPath = path.join(options.projectDir, ".kilocodemodes")
    allModes.push(...(await readModesFile(projectModesPath)))

    // Deduplicate by slug (later entries win)
    const modesBySlug = new Map<string, KilocodeMode>()
    for (const mode of allModes) {
      modesBySlug.set(mode.slug, mode)
    }

    // Process each mode
    for (const [slug, mode] of modesBySlug) {
      // Skip default modes - let Opencode's native agents handle these
      if (isDefaultMode(slug)) {
        result.skipped.push({
          slug,
          reason: "Default mode - using Opencode native agent instead",
        })
        continue
      }

      // Migrate custom mode
      const converted = build(mode, options.mcpServers ?? [])
      result.agents[slug] = converted.agent
      result.warnings.push(...converted.warnings.map((warning) => `Mode '${slug}': ${warning}`))
    }

    return result
  }
}
