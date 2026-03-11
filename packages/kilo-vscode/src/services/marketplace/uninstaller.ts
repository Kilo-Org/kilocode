import * as fs from "fs/promises"
import * as path from "path"
import * as yaml from "yaml"
import type {
  MarketplaceItem,
  McpMarketplaceItem,
  ModeMarketplaceItem,
  SkillMarketplaceItem,
  RemoveResult,
} from "./types"
import { MarketplacePaths } from "./paths"

export class MarketplaceUninstaller {
  constructor(private paths: MarketplacePaths) {}

  async remove(item: MarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    if (item.type === "mode") return this.removeMode(item, scope, workspace)
    if (item.type === "mcp") return this.removeMcp(item, scope, workspace)
    if (item.type === "skill") return this.removeSkill(item, scope, workspace)
    return { success: false, slug: (item as MarketplaceItem).id, error: "Unknown item type" }
  }

  async removeMode(item: ModeMarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    const filepath = this.paths.modesPath(scope, workspace)
    try {
      const mode = yaml.parse(item.content)
      const slug = mode?.slug ?? item.id

      const content = await fs.readFile(filepath, "utf-8")
      const data = yaml.parse(content)
      if (!data?.customModes || !Array.isArray(data.customModes)) {
        return { success: true, slug: item.id }
      }

      data.customModes = data.customModes.filter((m: Record<string, unknown>) => m.slug !== slug)
      await fs.writeFile(filepath, yaml.stringify(data, { lineWidth: 0 }), "utf-8")
      return { success: true, slug: item.id }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { success: true, slug: item.id }
      }
      console.warn(`Failed to remove mode ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    }
  }

  async removeMcp(item: McpMarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    const filepath = this.paths.mcpPath(scope, workspace)
    try {
      const content = await fs.readFile(filepath, "utf-8")
      const data = JSON.parse(content)
      if (!data?.mcpServers || typeof data.mcpServers !== "object") {
        return { success: true, slug: item.id }
      }

      delete data.mcpServers[item.id]
      await fs.writeFile(filepath, JSON.stringify(data, null, 2), "utf-8")
      return { success: true, slug: item.id }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { success: true, slug: item.id }
      }
      console.warn(`Failed to remove MCP ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    }
  }

  async removeSkill(
    item: SkillMarketplaceItem,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<RemoveResult> {
    if (
      !item.id ||
      item.id.includes("..") ||
      item.id.includes("/") ||
      item.id.includes("\\") ||
      !/^[\w\-@.]+$/.test(item.id)
    ) {
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
