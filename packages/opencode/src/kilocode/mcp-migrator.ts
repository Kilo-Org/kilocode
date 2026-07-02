import * as fs from "fs/promises"
import * as path from "path"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import { Config } from "../config/config"
import { ConfigMCP } from "../config/mcp"
import * as Log from "@opencode-ai/core/util/log"
import { isRecord } from "@/util/record"
import { Filesystem } from "../util/filesystem"
import { KilocodePaths } from "./paths"

export namespace McpMigrator {
  const log = Log.create({ service: "kilocode.mcp-migrator" })

  // Remote transport types used by the Kilocode extension plus the standard
  // `.mcp.json` spellings ("http"). Servers with a `url` but no `command` are
  // also treated as remote, matching the shared `.mcp.json` shorthand.
  const REMOTE_TYPES = new Set(["streamable-http", "http", "sse"])

  function isRemote(server: KilocodeMcpServer): boolean {
    if (server.type) return REMOTE_TYPES.has(server.type)
    return !!server.url && !server.command
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

    // 2. Project-level MCP settings (if projectDir provided)
    // Check .kilo/mcp.json and .kilocode/mcp.json for project-level settings
    // (not "mcp_settings.json" which is only used for global settings)
    // .kilocode is loaded first (lower precedence), .kilo second (higher precedence)
    if (options?.projectDir) {
      for (const dir of [".kilocode", ".kilo"]) {
        const projectSettingsPath = path.join(options.projectDir, dir, "mcp.json")
        const projectSettings = await readMcpSettings(projectSettingsPath)
        if (projectSettings?.mcpServers) {
          for (const [name, server] of Object.entries(projectSettings.mcpServers)) {
            allServers.push({ name, server }) // Later entries win in deduplication
          }
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

  /**
   * Read a shared external MCP config file in the standard `mcpServers` format
   * (JSON or JSONC, e.g. a canonical `.mcp.json`) and return its raw server map.
   * Returns an `error` string instead of throwing so callers can surface it as a warning.
   */
  export async function readMcpServersFile(
    filepath: string,
  ): Promise<{ servers?: Record<string, KilocodeMcpServer>; error?: string }> {
    if (!(await Filesystem.exists(filepath))) return { error: "file not found" }
    const text = await fs.readFile(filepath, "utf-8").catch(() => undefined)
    if (text === undefined) return { error: "could not read file" }

    const errors: ParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length > 0) return { error: "not valid JSON(C)" }
    if (!isRecord(data)) return { error: "expected a JSON object" }

    // The canonical shared format nests servers under `mcpServers`.
    if (data.mcpServers === undefined) return { servers: {} }
    if (!isRecord(data.mcpServers)) return { error: "`mcpServers` must be an object" }
    return { servers: data.mcpServers as Record<string, KilocodeMcpServer> }
  }

  /**
   * Load MCP servers from one or more shared external files referenced by
   * `mcpConfig.file`. Relative paths resolve from `root` (the project directory).
   * Later files win over earlier ones for the same server name.
   */
  export async function loadExternalMcpConfig(input: {
    files: string[]
    root: string
  }): Promise<{ mcp: Record<string, ConfigMCP.Info>; warnings: Config.Warning[] }> {
    const mcp: Record<string, ConfigMCP.Info> = {}
    const warnings: Config.Warning[] = []

    for (const entry of input.files) {
      if (!entry) continue
      const file = path.isAbsolute(entry) ? entry : path.resolve(input.root, entry)
      const read = await readMcpServersFile(file)
      if (read.error) {
        warnings.push({ path: file, message: `Could not load MCP config file at ${file}: ${read.error}` })
        log.warn("skipped external MCP config file", { file, error: read.error })
        continue
      }
      for (const [name, server] of Object.entries(read.servers ?? {})) {
        const converted = convertServer(name, server)
        if (converted) mcp[name] = converted
      }
      log.debug("loaded external MCP config file", { file, count: Object.keys(read.servers ?? {}).length })
    }

    return { mcp, warnings }
  }
}
