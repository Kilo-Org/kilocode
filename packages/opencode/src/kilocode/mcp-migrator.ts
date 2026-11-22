import * as fs from "fs/promises"
import * as path from "path"
import { Config } from "../config/config"
import { ConfigMCPV1 as ConfigMCP } from "@opencode-ai/core/v1/config/mcp"
import * as Log from "@opencode-ai/core/util/log"
import { Filesystem } from "../util/filesystem"
import { KilocodePaths } from "./paths"

export namespace McpMigrator {
  const log = Log.create({ service: "kilocode.mcp-migrator" })

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
    /** Whether a store this run read declared at least one MCP server, converted or not. */
    available: boolean
    /**
     * Names of the servers a skipped global store declared that this load did not cover: the
     * store a caller skipped - because `skipGlobalPaths` is set - is opened only to answer what
     * it held, its servers never enter `mcp`, and each of them this load could have granted but
     * did not is a loss a mode's `mcp` group cannot honour.
     *
     * A server is a loss when it is not disabled, the conversion would accept it, and the final
     * `mcp` does not hold its name: a same-named entry of a store this load read wins the dedup,
     * so that entry is the one converted or dropped.
     *
     * Only the caller that asked for the report (`reportSkippedGlobal`) gets that store opened.
     * An empty list therefore means "not checked" when the report was not asked for, and
     * "nothing was lost" when it was. The list never names a server this load covered.
     */
    skippedGlobalServers: string[]
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
    /**
     * Read the global store that `skipGlobalPaths` skipped only to answer what it held. Off by
     * default, so skipping global paths stays hermetic: a caller that does not ask for the report
     * never touches a global path, and `skippedGlobalServers` stays empty, meaning "not checked".
     */
    reportSkippedGlobal?: boolean
  }): Promise<MigrationResult> {
    const warnings: string[] = []
    const skipped: Array<{ name: string; reason: string }> = []
    const mcp: Record<string, ConfigMCP.Info> = {}
    // Servers a skipped store declared that no store this load read covers: what the load lost.
    const held = new Set<string>()

    const allServers: Array<{ name: string; server: KilocodeMcpServer }> = []

    // 1. VSCode extension global storage (primary location for global MCP settings)
    // A caller that skipped global paths and asked for the report gets the store read only to
    // answer what a mode's `mcp` group lost: its servers never enter `allServers` then, so
    // nothing from a skipped store is granted. A file that does not parse reads as absent.
    const skipGlobal = options?.skipGlobalPaths === true
    const report = options?.reportSkippedGlobal === true
    const readGlobal = !skipGlobal || report
    if (readGlobal) {
      const vscodeSettingsPath = path.join(KilocodePaths.vscodeGlobalStorage(), "settings", "mcp_settings.json")
      const vscodeSettings = await readMcpSettings(vscodeSettingsPath)
      for (const [name, server] of Object.entries(vscodeSettings?.mcpServers ?? {})) {
        if (!skipGlobal) {
          allServers.push({ name, server })
          continue
        }
        // A disabled server grants nothing when it is read, and neither does an entry the
        // conversion refuses, so withholding either loses nothing: only a server this load could
        // have granted is a loss.
        if (!server.disabled && (isRemote(server) ? !!server.url : !!server.command)) held.add(name)
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

    // A same-named entry a store this load read wins the dedup, so it is the one that converts: a
    // skipped name the final `mcp` holds is covered. An entry that did not convert is no loss
    // either, and `held` never includes one.
    const lost = [...held].filter((name) => !Object.hasOwn(mcp, name))

    return { mcp, available: serversByName.size > 0, skippedGlobalServers: lost, warnings, skipped }
  }

  /**
   * Load Kilocode MCP servers and report what the legacy stores declared.
   * `available` is true when a store this run read had at least one MCP server, even if
   * none of them could be converted. `skippedGlobalServers` names the servers of the VS Code
   * global store that this load skipped and did not cover: that store is then read only to answer
   * the question, and none of its servers is loaded. Without the report the store is never opened
   * and the list is empty, meaning "not checked" - and it is empty too when the store was read and
   * lost nothing. This function handles all logging internally.
   */
  export async function loadMcpConfig(
    projectDir: string,
    skipGlobalPaths?: boolean,
    reportSkippedGlobal?: boolean,
  ): Promise<{ mcp: Record<string, ConfigMCP.Info>; available: boolean; skippedGlobalServers: string[] }> {
    try {
      const result = await migrate({ projectDir, skipGlobalPaths, reportSkippedGlobal })

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

      return { mcp: result.mcp, available: result.available, skippedGlobalServers: result.skippedGlobalServers }
    } catch (err) {
      log.warn("failed to load kilocode MCP servers", { error: err })
      return { mcp: {}, available: false, skippedGlobalServers: [] }
    }
  }
}
