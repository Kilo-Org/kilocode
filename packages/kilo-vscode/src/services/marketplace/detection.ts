import * as fs from "fs/promises"
import * as path from "path"
import * as yaml from "yaml"
import type { MarketplaceInstalledMetadata } from "./types"
import { MarketplacePaths } from "./paths"

export class InstallationDetector {
  constructor(private paths: MarketplacePaths) {}

  async detect(workspace?: string): Promise<MarketplaceInstalledMetadata> {
    const project: Record<string, { type: string }> = {}
    const global: Record<string, { type: string }> = {}

    if (workspace) {
      await this.detectModes(this.paths.projectModesPath(workspace), project)
      await this.detectMcps(this.paths.projectMcpPath(workspace), project)
      await this.detectSkills(this.paths.projectSkillsDir(workspace), project)
    }

    await this.detectModes(this.paths.globalModesPath(), global)
    await this.detectMcps(this.paths.globalMcpPath(), global)
    await this.detectSkills(this.paths.globalSkillsDir(), global)

    return { project, global }
  }

  private async detectModes(filepath: string, record: Record<string, { type: string }>) {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      const parsed = yaml.parse(content)
      if (!parsed?.customModes || !Array.isArray(parsed.customModes)) return
      for (const mode of parsed.customModes) {
        if (mode.slug) {
          record[mode.slug] = { type: "mode" }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to detect modes from ${filepath}:`, err)
      }
    }
  }

  private async detectMcps(filepath: string, record: Record<string, { type: string }>) {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      const parsed = JSON.parse(content)
      if (!parsed?.mcpServers || typeof parsed.mcpServers !== "object") return
      for (const key of Object.keys(parsed.mcpServers)) {
        record[key] = { type: "mcp" }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to detect MCPs from ${filepath}:`, err)
      }
    }
  }

  private async detectSkills(dir: string, record: Record<string, { type: string }>) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          await fs.access(path.join(dir, entry.name, "SKILL.md"))
          record[entry.name] = { type: "skill" }
        } catch {
          console.warn(`Skill directory ${entry.name} missing SKILL.md, skipping`)
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to detect skills from ${dir}:`, err)
      }
    }
  }
}
