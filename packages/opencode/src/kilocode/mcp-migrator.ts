import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import { Config } from "../config/config"
import { ConfigMCPV1 as ConfigMCP } from "@opencode-ai/core/v1/config/mcp"
import * as Log from "@opencode-ai/core/util/log"
import { Filesystem } from "../util/filesystem"
import { KilocodePaths } from "./paths"

export namespace McpMigrator {
  const log = Log.create({ service: "kilocode.mcp-migrator" })
  const home = () => process.env.KILO_TEST_HOME || process.env.HOME || process.env.USERPROFILE || os.homedir()

  // Remote transport types used by the Kilocode extension
  const REMOTE_TYPES = new Set(["streamable-http", "sse"])

  function isRemote(server: KilocodeMcpServer): boolean {
    return !!server.type && REMOTE_TYPES.has(server.type)
  }

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

  export interface KilocodeMcpSettings {
    mcpServers: Record<string, KilocodeMcpServer>
  }

  export interface MigrationResult {
    mcp: Record<string, ConfigMCP.Info>
    warnings: string[]
    skipped: Array<{ name: string; reason: string }>
  }

  export async function readMcpSettings(filepath: string): Promise<KilocodeMcpSettings | null> {
    if (!(await Filesystem.exists(filepath))) return null

    try {
      const content = await fs.readFile(filepath, "utf-8")
      return JSON.parse(content) as KilocodeMcpSettings
    } catch (err) {
      log.warn("failed to parse MCP settings file, skipping", { filepath, error: err })
      return null
    }
  }

  export async function readMcpDirectory(
    mcpDir: string,
  ): Promise<Array<{ name: string; server: KilocodeMcpServer }>> {
    if (!(await Filesystem.isDir(mcpDir))) return []

    const servers: Array<{ name: string; server: KilocodeMcpServer }> = []
    try {
      const entries = await fs.readdir(mcpDir)
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue
        const name = entry.slice(0, -5)
        const filepath = path.join(mcpDir, entry)
        try {
          const content = await fs.readFile(filepath, "utf-8")
          const parsed = JSON.parse(content)
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            log.warn("MCP server entry must be a JSON object, skipping", { filepath })
            continue
          }
          const server = parsed as KilocodeMcpServer
          servers.push({ name, server })
        } catch (err) {
          log.warn("failed to parse MCP server file, skipping", { filepath, error: err })
        }
      }
    } catch (err) {
      log.warn("failed to read MCP directory", { dir: mcpDir, error: err })
    }
    return servers
  }

  export function convertServer(name: string, server: KilocodeMcpServer): ConfigMCP.Info | null {
    if (isRemote(server)) {
      if (!server.url) {
        log.warn("remote MCP server missing url, skipping", { name })
        return null
      }
      const config: ConfigMCP.Info = {
        type: "remote",
        url: server.url,
        ...(server.headers && Object.keys(server.headers).length > 0 && { headers: server.headers }),
        ...(server.disabled && { enabled: false }),
      }
      return config
    }

    if (!server.command) {
      log.warn("local MCP server missing command, skipping", { name })
      return null
    }

    // Build command array: [command, ...args]
    const command = [server.command, ...(server.args ?? [])]

    // Build the MCP config object
    const config: ConfigMCP.Info = {
      type: "local",
      command,
      ...(server.env && Object.keys(server.env).length > 0 && { environment: server.env }),
      ...(server.disabled && { enabled: false }),
    }

    return config
  }

  async function loadMcpFromDir(dirPath: string, allServers: Array<{ name: string; server: KilocodeMcpServer }>) {
    const filepath = path.join(dirPath, "mcp.json")
    const settings = await readMcpSettings(filepath)
    if (settings?.mcpServers) {
      for (const [name, server] of Object.entries(settings.mcpServers)) {
        allServers.push({ name, server })
      }
    }
    const mcpDir = path.join(dirPath, "mcp")
    const dirServers = await readMcpDirectory(mcpDir)
    allServers.push(...dirServers)
  }

  export async function migrate(options?: {
    projectDir?: string
    skipGlobalPaths?: boolean
  }): Promise<MigrationResult> {
    const warnings: string[] = []
    const skipped: Array<{ name: string; reason: string }> = []
    const mcp: Record<string, ConfigMCP.Info> = {}

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

    // 2. Global home-level configs (~/.kilocode and ~/.kilo)
    // File loaded first, then directory (directory overrides file)
    // .kilocode first (lower precedence), .kilo second (higher precedence)
    for (const dir of [".kilocode", ".kilo"]) {
      await loadMcpFromDir(path.join(home(), dir), allServers)
    }

    // 3. Project-level MCP settings (if projectDir provided)
    // .kilocode first (lower precedence), .kilo second (higher precedence)
    // Directory overrides file
    if (options?.projectDir) {
      for (const dir of [".kilocode", ".kilo"]) {
        await loadMcpFromDir(path.join(options.projectDir, dir), allServers)
      }
    }

    // Deduplicate by name (later entries win - project overrides global)
    const serversByName = new Map<string, KilocodeMcpServer>()
    for (const { name, server } of allServers) {
      serversByName.set(name, server)
    }

    // Convert each server. Errors for individual servers are caught so that
    // one malformed entry does not discard all otherwise valid MCP servers.
    for (const [name, server] of serversByName) {
      try {
        if (server.alwaysAllow && server.alwaysAllow.length > 0) {
          warnings.push(
            `MCP server '${name}' has alwaysAllow permissions that cannot be migrated: ${server.alwaysAllow.join(", ")}`,
          )
        }

        const converted = convertServer(name, server)
        if (converted) {
          mcp[name] = converted
        }
      } catch (err) {
        log.warn("failed to migrate MCP server, skipping", { name, error: err })
        skipped.push({ name, reason: `conversion error: ${err}` })
      }
    }

    return { mcp, warnings, skipped }
  }

  /**
   * Load Kilocode MCP servers and return them as an opencode config partial.
   * This function handles all logging internally, so callers just need to merge the result.
   */
  export async function loadMcpConfig(
    projectDir: string,
    skipGlobalPaths?: boolean,
  ): Promise<Record<string, ConfigMCP.Info>> {
    try {
      const result = await migrate({ projectDir, skipGlobalPaths })

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
