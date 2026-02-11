import * as fs from "fs/promises"
import * as path from "path"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { KilocodePaths } from "./paths"

export namespace McpMigrator {
  const log = Log.create({ service: "kilocode.mcp-migrator" })

  // Kilocode MCP server structure
  export interface KilocodeMcpServer {
    command?: string
    args?: string[]
    env?: Record<string, string>
    disabled?: boolean
    alwaysAllow?: string[]
    // Remote server fields
    type?: string
    url?: string
    headers?: Record<string, string>
  }

  const REMOTE_TYPES = new Set(["streamable-http", "sse"])

  function isRemote(server: KilocodeMcpServer): boolean {
    return !!server.url || REMOTE_TYPES.has(server.type ?? "")
  }

  export interface KilocodeMcpSettings {
    mcpServers: Record<string, KilocodeMcpServer>
  }

  export interface MigrationResult {
    mcp: Record<string, Config.Mcp>
    warnings: string[]
    skipped: Array<{ name: string; reason: string }>
  }

  export async function readMcpSettings(filepath: string): Promise<KilocodeMcpSettings | null> {
    if (!(await Filesystem.exists(filepath))) return null

    const content = await fs.readFile(filepath, "utf-8")
    return JSON.parse(content) as KilocodeMcpSettings
  }

  export function convertServer(name: string, server: KilocodeMcpServer): Config.Mcp | null {
    // Skip disabled servers
    if (server.disabled) return null

    // Remote servers (streamable-http, sse, or any config with a url)
    if (isRemote(server)) {
      const mcpConfig: Config.Mcp = {
        type: "remote",
        url: server.url!,
        ...(server.headers && Object.keys(server.headers).length > 0 && { headers: server.headers }),
      }
      return mcpConfig
    }

    // Local/stdio servers
    const command = [server.command!, ...(server.args ?? [])]
    const mcpConfig: Config.Mcp = {
      type: "local",
      command,
      ...(server.env && Object.keys(server.env).length > 0 && { environment: server.env }),
    }

    return mcpConfig
  }

  export async function migrate(options?: {
    projectDir?: string
    skipGlobalPaths?: boolean
  }): Promise<MigrationResult> {
    const warnings: string[] = []
    const skipped: Array<{ name: string; reason: string }> = []
    const mcp: Record<string, Config.Mcp> = {}

    const allServers: Array<{ name: string; server: KilocodeMcpServer }> = []

    if (!options?.skipGlobalPaths) {
      // 1. VSCode extension global storage (primary location for global MCP settings)
      const vscodeSettingsPath = path.join(KilocodePaths.vscodeGlobalStorage(), "settings", "mcp_settings.json")
      const vscodeSettings = await readMcpSettings(vscodeSettingsPath)
      if (vscodeSettings?.mcpServers) {
        for (const [name, server] of Object.entries(vscodeSettings.mcpServers)) {
          allServers.push({ name, server })
        }
      }
    }

    // 2. Project-level MCP settings (if projectDir provided)
    // The Kilocode extension uses ".kilocode/mcp.json" for project-level settings
    // (not "mcp_settings.json" which is only used for global settings)
    if (options?.projectDir) {
      const projectSettingsPath = path.join(options.projectDir, ".kilocode", "mcp.json")
      const projectSettings = await readMcpSettings(projectSettingsPath)
      if (projectSettings?.mcpServers) {
        for (const [name, server] of Object.entries(projectSettings.mcpServers)) {
          allServers.push({ name, server }) // Later entries win in deduplication
        }
      }
    }

    // Deduplicate by name (later entries win - project overrides global)
    const serversByName = new Map<string, KilocodeMcpServer>()
    for (const { name, server } of allServers) {
      serversByName.set(name, server)
    }

    // Convert each server
    for (const [name, server] of serversByName) {
      if (server.disabled) {
        skipped.push({ name, reason: "Server is disabled" })
        continue
      }

      // Warn about alwaysAllow permissions that cannot be migrated
      if (server.alwaysAllow && server.alwaysAllow.length > 0) {
        warnings.push(
          `MCP server '${name}' has alwaysAllow permissions that cannot be migrated: ${server.alwaysAllow.join(", ")}`,
        )
      }

      const converted = convertServer(name, server)
      if (converted) {
        mcp[name] = converted
      }
    }

    return { mcp, warnings, skipped }
  }

  /**
   * Load Kilocode MCP servers and return them as an opencode config partial.
   * This function handles all logging internally, so callers just need to merge the result.
   */
  export async function loadMcpConfig(projectDir: string): Promise<Record<string, Config.Mcp>> {
    try {
      const result = await migrate({ projectDir })

      if (Object.keys(result.mcp).length > 0) {
        log.debug("loaded kilocode MCP servers", {
          count: Object.keys(result.mcp).length,
          servers: Object.keys(result.mcp),
        })
      }

      for (const skipped of result.skipped) {
        log.debug("skipped kilocode MCP server", { name: skipped.name, reason: skipped.reason })
      }

      for (const warning of result.warnings) {
        log.warn("kilocode MCP migration warning", { warning })
      }

      return result.mcp
    } catch (err) {
      log.warn("failed to load kilocode MCP servers", { error: err })
      return {}
    }
  }
}
