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
} from "./types"
import { MarketplacePaths } from "./paths"

const exec = promisify(execFile)

export class MarketplaceInstaller {
  constructor(private paths: MarketplacePaths) {}

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

  async installMode(
    item: ModeMarketplaceItem,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<InstallResult> {
    const filepath = this.paths.modesPath(scope, workspace)
    try {
      const mode = yaml.parse(item.content)
      if (!mode?.slug) {
        return { success: false, slug: item.id, error: "Mode content missing slug" }
      }

      const existing = await this.readYaml(filepath)
      if (existing === null) {
        return { success: false, slug: item.id, error: "Existing modes file has invalid YAML" }
      }

      const data = existing ?? { customModes: [] as Record<string, unknown>[] }
      if (!Array.isArray(data.customModes)) {
        data.customModes = [] as Record<string, unknown>[]
      }

      const modes = data.customModes as Record<string, unknown>[]
      data.customModes = modes.filter((m) => m.slug !== mode.slug)
      ;(data.customModes as Record<string, unknown>[]).push(mode)

      await fs.mkdir(path.dirname(filepath), { recursive: true })
      const output = yaml.stringify(data, { lineWidth: 0 })
      await fs.writeFile(filepath, output, "utf-8")

      const line = findLineNumber(output, `slug: ${mode.slug}`)
      return { success: true, slug: item.id, filePath: filepath, line }
    } catch (err) {
      console.warn(`Failed to install mode ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    }
  }

  async installMcp(
    item: McpMarketplaceItem,
    options: InstallMarketplaceItemOptions,
    workspace?: string,
  ): Promise<InstallResult> {
    const scope = options.target ?? "project"
    const filepath = this.paths.mcpPath(scope, workspace)
    try {
      const template = resolveTemplate(item, options)
      const filled = substituteParams(template, options.parameters ?? {})
      const parsed = JSON.parse(filled)

      const existing = await this.readJson(filepath)
      if (existing === null) {
        return { success: false, slug: item.id, error: "Existing MCP file has invalid JSON" }
      }

      const data = existing ?? { mcpServers: {} as Record<string, unknown> }
      if (!data.mcpServers || typeof data.mcpServers !== "object") {
        data.mcpServers = {} as Record<string, unknown>
      }

      ;(data.mcpServers as Record<string, unknown>)[item.id] = parsed

      await fs.mkdir(path.dirname(filepath), { recursive: true })
      const output = JSON.stringify(data, null, 2)
      await fs.writeFile(filepath, output, "utf-8")

      const line = findLineNumber(output, `"${item.id}"`)
      return { success: true, slug: item.id, filePath: filepath, line }
    } catch (err) {
      console.warn(`Failed to install MCP ${item.id}:`, err)
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

      // Extract to a staging directory so we can validate before touching
      // the real install path (preserves any existing installation on failure).
      await fs.mkdir(staging, { recursive: true })
      await exec("tar", ["-xzf", tarball, "--strip-components=1", "-C", staging])

      // Reject archives with entries that escaped the staging directory
      // (absolute paths, symlinks, or .. segments).
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

  private async readYaml(filepath: string): Promise<Record<string, unknown> | undefined | null> {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      try {
        return yaml.parse(content) ?? { customModes: [] }
      } catch {
        console.warn(`Invalid YAML in ${filepath}`)
        return null
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw err
    }
  }

  private async readJson(filepath: string): Promise<Record<string, unknown> | undefined | null> {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      try {
        return JSON.parse(content)
      } catch {
        console.warn(`Invalid JSON in ${filepath}`)
        return null
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw err
    }
  }
}

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
      // Check symlinks point within the directory
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
