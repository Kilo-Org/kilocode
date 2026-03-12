import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as yaml from "yaml"
import { execFile } from "child_process"
import { promisify } from "util"
import type {
  MarketplaceItem,
  McpMarketplaceItem,
  ModeMarketplaceItem,
  SkillMarketplaceItem,
  InstallMarketplaceItemOptions,
  InstallResult,
  RemoveResult,
} from "./types"
import { MarketplacePaths } from "./paths"

const exec = promisify(execFile)

// ── Opencode config types ───────────────────────────────────────────

interface McpLocal {
  type: "local"
  command: string[]
  environment?: Record<string, string>
}

interface McpRemote {
  type: "remote"
  url: string
  headers?: Record<string, string>
}

type McpEntry = McpLocal | McpRemote

interface AgentEntry {
  mode: string
  description?: string
  prompt?: string
  permission?: Record<string, unknown>
}

interface KiloConfig {
  $schema?: string
  mcp?: Record<string, McpEntry>
  agent?: Record<string, AgentEntry>
  [key: string]: unknown
}

// ── Kilocode legacy format (from marketplace API) ───────────────────

interface LegacyMcp {
  command?: string
  args?: string[]
  env?: Record<string, string>
  type?: string
  url?: string
  headers?: Record<string, string>
}

// ── Installer ───────────────────────────────────────────────────────

export class MarketplaceInstaller {
  constructor(private paths: MarketplacePaths) {}

  // ── Install ──────────────────────────────────────────────────────

  async install(
    item: MarketplaceItem,
    options: InstallMarketplaceItemOptions,
    workspace?: string,
  ): Promise<InstallResult> {
    const scope = options.target ?? "project"
    if (item.type === "mode") return this.installMode(item, scope, workspace)
    if (item.type === "mcp") return this.installMcp(item, options, workspace)
    if (item.type === "skill") return this.installSkill(item, scope, workspace)
    return { success: false, slug: (item as MarketplaceItem).id, error: `Unknown item type` }
  }

  async installMcp(
    item: McpMarketplaceItem,
    options: InstallMarketplaceItemOptions,
    workspace?: string,
  ): Promise<InstallResult> {
    const scope = options.target ?? "project"
    const filepath = this.paths.configPath(scope, workspace)
    try {
      const template = resolveTemplate(item, options)
      const filled = substituteParams(template, options.parameters ?? {})
      const legacy: LegacyMcp = JSON.parse(filled)
      const entry = convertMcp(legacy)
      if (!entry) return { success: false, slug: item.id, error: "Invalid MCP configuration" }

      const config = await readConfig(filepath)
      config.mcp ??= {}
      config.mcp[item.id] = entry

      await writeConfig(filepath, config)

      const output = JSON.stringify(config, null, 2)
      const line = findLineNumber(output, `"${item.id}"`)
      return { success: true, slug: item.id, filePath: filepath, line }
    } catch (err) {
      console.warn(`Failed to install MCP ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    }
  }

  async installMode(
    item: ModeMarketplaceItem,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<InstallResult> {
    const filepath = this.paths.configPath(scope, workspace)
    try {
      const mode = yaml.parse(item.content)
      if (!mode?.slug) return { success: false, slug: item.id, error: "Mode content missing slug" }

      const agent = convertMode(mode)
      const config = await readConfig(filepath)
      config.agent ??= {}
      config.agent[mode.slug] = agent

      await writeConfig(filepath, config)

      const output = JSON.stringify(config, null, 2)
      const line = findLineNumber(output, `"${mode.slug}"`)
      return { success: true, slug: item.id, filePath: filepath, line }
    } catch (err) {
      console.warn(`Failed to install mode ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    }
  }

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

  // ── Remove ───────────────────────────────────────────────────────

  async remove(item: MarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    if (item.type === "mode") return this.removeMode(item, scope, workspace)
    if (item.type === "mcp") return this.removeMcp(item, scope, workspace)
    if (item.type === "skill") return this.removeSkill(item, scope, workspace)
    return { success: false, slug: (item as MarketplaceItem).id, error: "Unknown item type" }
  }

  async removeMcp(item: McpMarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    const filepath = this.paths.configPath(scope, workspace)
    try {
      const config = await readConfig(filepath)
      if (!config.mcp?.[item.id]) return { success: true, slug: item.id }
      delete config.mcp[item.id]
      await writeConfig(filepath, config)
      return { success: true, slug: item.id }
    } catch (err) {
      console.warn(`Failed to remove MCP ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    }
  }

  async removeMode(item: ModeMarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    const filepath = this.paths.configPath(scope, workspace)
    try {
      const mode = yaml.parse(item.content)
      const slug = mode?.slug ?? item.id
      const config = await readConfig(filepath)
      if (!config.agent?.[slug]) return { success: true, slug: item.id }
      delete config.agent[slug]
      await writeConfig(filepath, config)
      return { success: true, slug: item.id }
    } catch (err) {
      console.warn(`Failed to remove mode ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    }
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
}

// ── Config file helpers ─────────────────────────────────────────────

async function readConfig(filepath: string): Promise<KiloConfig> {
  try {
    const content = await fs.readFile(filepath, "utf-8")
    return JSON.parse(content)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw err
  }
}

async function writeConfig(filepath: string, config: KiloConfig): Promise<void> {
  config.$schema ??= "https://kilo.ai/config.json"
  await fs.mkdir(path.dirname(filepath), { recursive: true })
  await fs.writeFile(filepath, JSON.stringify(config, null, 2), "utf-8")
}

// ── Format converters ───────────────────────────────────────────────

const REMOTE_TYPES = new Set(["streamable-http", "sse"])

function convertMcp(legacy: LegacyMcp): McpEntry | null {
  if (legacy.type && REMOTE_TYPES.has(legacy.type)) {
    if (!legacy.url) return null
    const entry: McpRemote = { type: "remote", url: legacy.url }
    if (legacy.headers && Object.keys(legacy.headers).length > 0) entry.headers = legacy.headers
    return entry
  }

  if (!legacy.command) return null
  const entry: McpLocal = {
    type: "local",
    command: [legacy.command, ...(legacy.args ?? [])],
  }
  if (legacy.env && Object.keys(legacy.env).length > 0) entry.environment = legacy.env
  return entry
}

const GROUP_TO_PERMISSION: Record<string, string> = {
  read: "read",
  edit: "edit",
  browser: "bash",
  command: "bash",
  mcp: "mcp",
}

const ALL_PERMISSIONS = ["read", "edit", "bash", "mcp"]

function convertMode(mode: Record<string, unknown>): AgentEntry {
  const prompt = [mode.roleDefinition, mode.customInstructions].filter(Boolean).join("\n\n")
  const groups = (mode.groups ?? []) as Array<string | [string, { fileRegex?: string }]>

  const permission: Record<string, unknown> = {}
  const allowed = new Set<string>()

  for (const group of groups) {
    if (typeof group === "string") {
      const key = GROUP_TO_PERMISSION[group] ?? group
      allowed.add(key)
      permission[key] = "allow"
    } else if (Array.isArray(group)) {
      const [name, config] = group
      const key = GROUP_TO_PERMISSION[name] ?? name
      allowed.add(key)
      permission[key] = config?.fileRegex ? { [config.fileRegex]: "allow", "*": "deny" } : "allow"
    }
  }

  for (const perm of ALL_PERMISSIONS) {
    if (!allowed.has(perm)) permission[perm] = "deny"
  }

  return {
    mode: "primary",
    description: (mode.description ?? mode.whenToUse ?? mode.name) as string,
    prompt,
    permission,
  }
}

// ── Template/param helpers ──────────────────────────────────────────

function resolveTemplate(item: McpMarketplaceItem, options: InstallMarketplaceItemOptions): string {
  if (typeof item.content === "string") return item.content
  const index = (options.parameters?._selectedIndex as number) ?? 0
  const method = item.content[index]
  if (!method) return item.content[0].content
  return method.content
}

function escapeJsonValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
}

function substituteParams(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = params[key]
    if (value === undefined || value === null) return `{{${key}}}`
    return escapeJsonValue(String(value))
  })
}

function isSafeId(id: string): boolean {
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) return false
  return /^[\w\-@.]+$/.test(id)
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

function findLineNumber(content: string, search: string): number {
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(search)) return i + 1
  }
  return 1
}
