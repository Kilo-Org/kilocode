import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as yaml from "yaml"
import { exec } from "../../util/process"
import type {
  MarketplaceItem,
  SkillMarketplaceItem,
  McpMarketplaceItem,
  ModeMarketplaceItem,
  McpInstallationMethod,
  InstallMarketplaceItemOptions,
  InstallResult,
  RemoveResult,
} from "./types"
import { MarketplacePaths } from "./paths"

export class MarketplaceInstaller {
  constructor(private paths: MarketplacePaths) {}

  async install(
    item: MarketplaceItem,
    options: InstallMarketplaceItemOptions,
    workspace?: string,
  ): Promise<InstallResult> {
    const scope = options.target ?? "project"
    if (item.type === "skill") return this.installSkill(item, scope, workspace)
    if (item.type === "mcp") return this.installMcp(item, options, scope, workspace)
    return this.installMode(item, scope, workspace)
  }

  // ── MCP ─────────────────────────────────────────────────────────────

  async installMcp(
    item: McpMarketplaceItem,
    options: InstallMarketplaceItemOptions,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<InstallResult> {
    if (scope === "project" && !workspace) {
      return { success: false, slug: item.id, error: "No workspace directory for project-scope install" }
    }

    const config = await this.readConfig(scope, workspace)
    if (!config.mcp) config.mcp = {}

    if (config.mcp[item.id]) {
      return { success: false, slug: item.id, error: "MCP server already installed. Remove it first." }
    }

    const content = this.resolveMcpContent(item, options)
    if (!content) {
      return { success: false, slug: item.id, error: "No installation content for MCP server" }
    }

    try {
      config.mcp[item.id] = this.buildMcpEntry(content, options.parameters)
    } catch (err) {
      return { success: false, slug: item.id, error: `Invalid MCP config: ${err}` }
    }

    await this.writeConfig(scope, workspace, config)
    return { success: true, slug: item.id }
  }

  private resolveMcpContent(item: McpMarketplaceItem, options: InstallMarketplaceItemOptions): string | undefined {
    if (typeof item.content === "string") return item.content
    if (!Array.isArray(item.content) || item.content.length === 0) return undefined
    const name = options.parameters?.__method as string | undefined
    if (name) {
      const found = item.content.find((m: McpInstallationMethod) => m.name === name)
      if (found) return found.content
    }
    return item.content[0].content
  }

  private buildMcpEntry(content: string, params?: Record<string, unknown>): Record<string, unknown> {
    const filtered = Object.fromEntries(Object.entries(params ?? {}).filter(([k]) => k !== "__method"))
    const replaced = Object.keys(filtered).length > 0 ? substituteParams(content, filtered) : content
    const raw = JSON.parse(replaced) as Record<string, unknown>
    return normalizeMcpEntry(raw)
  }

  // ── Mode ────────────────────────────────────────────────────────────

  async installMode(
    item: ModeMarketplaceItem,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<InstallResult> {
    if (scope === "project" && !workspace) {
      return { success: false, slug: item.id, error: "No workspace directory for project-scope install" }
    }

    const config = await this.readConfig(scope, workspace)
    if (!config.agent) config.agent = {}

    if (config.agent[item.id]) {
      return { success: false, slug: item.id, error: "Mode already installed. Remove it first." }
    }

    config.agent[item.id] = convertModeToAgent(item.content)

    await this.writeConfig(scope, workspace, config)
    return { success: true, slug: item.id }
  }

  // ── Skill ───────────────────────────────────────────────────────────

  async installSkill(
    item: SkillMarketplaceItem,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<InstallResult> {
    if (!item.content) {
      return { success: false, slug: item.id, error: "Skill has no tarball URL" }
    }

    if (!isSafeId(item.id)) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }

    const base = this.paths.skillsDir(scope, workspace)
    const dir = path.join(base, item.id)
    if (!path.resolve(dir).startsWith(path.resolve(base))) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }

    try {
      await fs.access(dir)
      return { success: false, slug: item.id, error: "Skill already installed. Uninstall it before installing again." }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }

    const stamp = Date.now()
    const tarball = path.join(os.tmpdir(), `kilo-skill-${item.id}-${stamp}.tar.gz`)
    // Stage under `base` (not os.tmpdir()) so fs.rename() never crosses filesystems (EXDEV).
    await fs.mkdir(base, { recursive: true })
    const staging = path.join(base, `.staging-${item.id}-${stamp}`)

    try {
      const response = await fetch(item.content)
      if (!response.ok) {
        return { success: false, slug: item.id, error: `Download failed: ${response.status}` }
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      await fs.writeFile(tarball, buffer)

      await fs.mkdir(staging, { recursive: true })
      await exec("tar", ["-xzf", tarball, "--strip-components=1", "-C", staging])

      const escaped = await findEscapedPaths(staging)
      if (escaped.length > 0) {
        console.warn(`Skill archive ${item.id} contains escaped paths:`, escaped)
        await fs.rm(staging, { recursive: true })
        return { success: false, slug: item.id, error: "Skill archive contains unsafe paths" }
      }

      try {
        await fs.access(path.join(staging, "SKILL.md"))
      } catch {
        console.warn(`Extracted skill ${item.id} missing SKILL.md, rolling back`)
        await fs.rm(staging, { recursive: true })
        return { success: false, slug: item.id, error: "Extracted archive missing SKILL.md" }
      }

      await fs.rename(staging, dir)

      return { success: true, slug: item.id, filePath: path.join(dir, "SKILL.md"), line: 1 }
    } catch (err) {
      console.warn(`Failed to install skill ${item.id}:`, err)
      try {
        await fs.rm(staging, { recursive: true })
      } catch {
        console.warn(`Failed to clean up staging directory ${staging}`)
      }
      return { success: false, slug: item.id, error: String(err) }
    } finally {
      try {
        await fs.unlink(tarball)
      } catch {
        console.warn(`Failed to clean up temp file ${tarball}`)
      }
    }
  }

  // ── Remove ──────────────────────────────────────────────────────────

  async remove(item: MarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    if (item.type === "skill") return this.removeSkill(item, scope, workspace)
    if (item.type === "mcp") return this.removeMcp(item, scope, workspace)
    return this.removeMode(item, scope, workspace)
  }

  async removeMcp(item: McpMarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    const config = await this.readConfig(scope, workspace)
    if (!config.mcp?.[item.id]) {
      return { success: true, slug: item.id }
    }
    delete config.mcp[item.id]
    if (Object.keys(config.mcp).length === 0) delete config.mcp
    await this.writeConfig(scope, workspace, config)
    return { success: true, slug: item.id }
  }

  async removeMode(item: ModeMarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    const config = await this.readConfig(scope, workspace)
    if (!config.agent?.[item.id]) {
      return { success: true, slug: item.id }
    }
    delete config.agent[item.id]
    if (Object.keys(config.agent).length === 0) delete config.agent
    await this.writeConfig(scope, workspace, config)
    return { success: true, slug: item.id }
  }

  async removeSkill(
    item: SkillMarketplaceItem,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<RemoveResult> {
    if (!isSafeId(item.id)) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }
    const base = this.paths.skillsDir(scope, workspace)
    const dir = path.join(base, item.id)
    if (!path.resolve(dir).startsWith(path.resolve(base))) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }
    try {
      await fs.access(dir)
      await fs.rm(dir, { recursive: true })
      return { success: true, slug: item.id }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { success: true, slug: item.id }
      }
      console.warn(`Failed to remove skill ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    }
  }

  // ── Config helpers ──────────────────────────────────────────────────

  private async readConfig(
    scope: "project" | "global",
    workspace?: string,
  ): Promise<Record<string, Record<string, unknown>>> {
    const filepath = this.paths.configPath(scope, workspace)
    try {
      const content = await fs.readFile(filepath, "utf-8")
      return JSON.parse(content)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {}
      throw err
    }
  }

  private async writeConfig(
    scope: "project" | "global",
    workspace: string | undefined,
    config: Record<string, unknown>,
  ): Promise<void> {
    const filepath = this.paths.configPath(scope, workspace)
    await fs.mkdir(path.dirname(filepath), { recursive: true })
    await fs.writeFile(filepath, JSON.stringify(config, null, 2) + "\n", "utf-8")
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Normalize a marketplace MCP entry from the old Kilocode format to the CLI's expected format.
 *
 * Old format (from marketplace API):
 *   { "command": "npx", "args": [...], "env": {...} }
 *   { "type": "sse"|"streamable-http", "url": "...", "headers": {...} }
 *
 * New format (CLI Config.Mcp schema):
 *   { "type": "local", "command": ["npx", ...], "environment": {...} }
 *   { "type": "remote", "url": "...", "headers": {...} }
 */
function normalizeMcpEntry(raw: Record<string, unknown>): Record<string, unknown> {
  // Already in new format
  if (raw.type === "local" || raw.type === "remote") return raw

  // Remote MCP (sse / streamable-http) → type: "remote"
  if (typeof raw.url === "string") {
    const { type: _type, url, headers, ...rest } = raw
    const entry: Record<string, unknown> = { type: "remote", url }
    if (headers && typeof headers === "object") entry.headers = headers
    // Carry through any other recognized fields (enabled, timeout, oauth)
    for (const key of ["enabled", "timeout", "oauth"] as const) {
      if (key in rest) entry[key] = rest[key]
    }
    return entry
  }

  // Local MCP (command string + args array) → type: "local", command array
  if (typeof raw.command === "string") {
    const args = (raw.args as string[] | undefined) ?? []
    const env = raw.env
    const entry: Record<string, unknown> = { type: "local", command: [raw.command, ...args] }
    if (env && typeof env === "object" && Object.keys(env as object).length > 0) entry.environment = env
    for (const key of ["enabled", "timeout"] as const) {
      if (key in raw) entry[key] = raw[key]
    }
    return entry
  }

  return raw
}

function isSafeId(id: string): boolean {
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) return false
  return /^[\w\-@.]+$/.test(id)
}

// Group name → opencode permission key mapping (mirrors ModesMigrator)
const GROUP_PERMISSIONS: Record<string, string> = {
  read: "read",
  edit: "edit",
  browser: "bash",
  command: "bash",
  mcp: "mcp",
}
const ALL_PERMISSIONS = ["read", "edit", "bash", "mcp"]

function convertModeToAgent(content: string): Record<string, unknown> {
  const mode = yaml.parse(content) as Record<string, unknown>
  const groups = (mode.groups ?? []) as Array<string | [string, Record<string, unknown>]>

  const permission: Record<string, unknown> = {}
  const allowed = new Set<string>()
  for (const group of groups) {
    if (typeof group === "string") {
      const key = GROUP_PERMISSIONS[group] ?? group
      allowed.add(key)
      permission[key] = "allow"
    } else if (Array.isArray(group)) {
      const [name, cfg] = group
      const key = GROUP_PERMISSIONS[name] ?? name
      allowed.add(key)
      permission[key] = cfg?.fileRegex ? { [String(cfg.fileRegex)]: "allow", "*": "deny" } : "allow"
    }
  }
  for (const perm of ALL_PERMISSIONS) {
    if (!allowed.has(perm)) permission[perm] = "deny"
  }

  const prompt = [mode.roleDefinition, mode.customInstructions].filter(Boolean).join("\n\n")
  return {
    mode: "primary",
    description: mode.description ?? mode.whenToUse ?? mode.name,
    prompt,
    permission,
  }
}

function escapeJsonValue(raw: string): string {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
}

function substituteParams(template: string, params: Record<string, unknown>): string {
  let result = template
  for (const [key, value] of Object.entries(params)) {
    const escaped = escapeJsonValue(String(value ?? ""))
    result = result.replaceAll(`{{${key}}}`, escaped)
    result = result.replaceAll(`\${${key}}`, escaped)
  }
  return result
}

async function findEscapedPaths(dir: string): Promise<string[]> {
  const resolved = path.resolve(dir)
  const escaped: string[] = []

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.resolve(current, entry.name)
      if (!full.startsWith(resolved + path.sep) && full !== resolved) {
        escaped.push(full)
        continue
      }
      if (entry.isSymbolicLink()) {
        const target = await fs.realpath(full)
        if (!target.startsWith(resolved + path.sep) && target !== resolved) {
          escaped.push(full)
          continue
        }
      }
      if (entry.isDirectory()) {
        await walk(full)
      }
    }
  }

  await walk(dir)
  return escaped
}
