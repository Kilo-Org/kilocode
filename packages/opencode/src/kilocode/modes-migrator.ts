import matter from "gray-matter"
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import { Config } from "../config/config"
import { KilocodePaths } from "./paths"

export namespace ModesMigrator {
  // Kilocode mode structure
  export interface KilocodeMode {
    slug: string
    name: string
    roleDefinition: string
    groups: Array<string | [string, { fileRegex?: string; description?: string }]>
    customInstructions?: string
    whenToUse?: string
    description?: string
    source?: "global" | "project" | "organization"
  }

  export interface KilocodeModesFile {
    customModes: KilocodeMode[]
  }

  // Default modes to skip - these have native Opencode equivalents
  // kilocode_change - added "build" for backward compatibility after renaming "build" to "code"
  const DEFAULT_MODE_SLUGS = new Set(["code", "build", "architect", "ask", "debug", "orchestrator"])

  // Group to permission mapping
  const GROUP_TO_PERMISSION: Record<string, string> = {
    read: "read",
    edit: "edit",
    browser: "bash",
    command: "bash",
    mcp: "mcp",
  }

  // All permissions that should be explicitly set (deny if not in groups)
  const ALL_PERMISSIONS = ["read", "edit", "bash", "mcp"]

  export function isDefaultMode(slug: string): boolean {
    return DEFAULT_MODE_SLUGS.has(slug)
  }

  export function convertPermissions(groups: KilocodeMode["groups"]): Config.Permission {
    const permission: Record<string, any> = {}
    const allowedPermissions = new Set<string>()

    for (const group of groups) {
      if (typeof group === "string") {
        const permKey = GROUP_TO_PERMISSION[group] ?? group
        allowedPermissions.add(permKey)
        permission[permKey] = "allow"
      } else if (Array.isArray(group)) {
        const [groupName, config] = group
        const permKey = GROUP_TO_PERMISSION[groupName] ?? groupName
        allowedPermissions.add(permKey)

        if (config?.fileRegex) {
          permission[permKey] = {
            [config.fileRegex]: "allow",
            "*": "deny",
          }
        } else {
          permission[permKey] = "allow"
        }
      }
    }

    // Explicitly deny permissions that aren't in the groups
    // This is critical because Opencode defaults to "ask" for missing permissions
    for (const perm of ALL_PERMISSIONS) {
      if (!allowedPermissions.has(perm)) {
        permission[perm] = "deny"
      }
    }

    return permission
  }

  export function convertMode(mode: KilocodeMode): Config.Agent {
    const prompt = [mode.roleDefinition, mode.customInstructions].filter(Boolean).join("\n\n")

    return {
      mode: "primary",
      description: mode.description ?? mode.whenToUse ?? mode.name,
      prompt,
      permission: convertPermissions(mode.groups),
    }
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
    agents: Record<string, Config.Agent>
    skipped: Array<{ slug: string; reason: string }>
  }

  export async function migrate(options: {
    projectDir: string
    globalSettingsDir?: string
    /** Skip reading from global paths (VSCode storage, home dir). Used for testing. */
    skipGlobalPaths?: boolean
  }): Promise<MigrationResult> {
    const result: MigrationResult = {
      agents: {},
      skipped: [],
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
      result.agents[slug] = convertMode(mode)
    }

    return result
  }
}
