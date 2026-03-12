import * as fs from "fs/promises"
import * as path from "path"
import * as yaml from "yaml"
import type { MarketplaceInstalledMetadata } from "./types"
import { MarketplacePaths } from "./paths"

type Entry = [string, { type: string }]

export class InstallationDetector {
  constructor(private paths: MarketplacePaths) {}

  async detect(workspace?: string): Promise<MarketplaceInstalledMetadata> {
    const project = workspace
      ? Object.fromEntries(
          (
            await Promise.all([
              this.detectModes(this.paths.projectModesPath(workspace)),
              this.detectMcps(this.paths.projectMcpPath(workspace)),
              this.detectSkills(this.paths.projectSkillsDir(workspace)),
            ])
          ).flat(),
        )
      : {}

    const global = Object.fromEntries(
      (
        await Promise.all([
          this.detectModes(this.paths.globalModesPath()),
          this.detectMcps(this.paths.globalMcpPath()),
          this.detectSkills(this.paths.globalSkillsDir()),
        ])
      ).flat(),
    )

    return { project, global }
  }

  private async detectModes(filepath: string): Promise<Entry[]> {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      const parsed = yaml.parse(content)
      if (!parsed?.customModes || !Array.isArray(parsed.customModes)) return []
      return parsed.customModes
        .filter((mode: { slug?: string }) => mode.slug)
        .map((mode: { slug: string }) => [mode.slug, { type: "mode" }])
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to detect modes from ${filepath}:`, err)
      }
      return []
    }
  }

  private async detectMcps(filepath: string): Promise<Entry[]> {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      const parsed = JSON.parse(content)
      if (!parsed?.mcpServers || typeof parsed.mcpServers !== "object") return []
      return Object.keys(parsed.mcpServers).map((key) => [key, { type: "mcp" }])
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to detect MCPs from ${filepath}:`, err)
      }
      return []
    }
  }

  private async detectSkills(dir: string): Promise<Entry[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const results: Entry[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          await fs.access(path.join(dir, entry.name, "SKILL.md"))
          results.push([entry.name, { type: "skill" }])
        } catch {
          console.warn(`Skill directory ${entry.name} missing SKILL.md, skipping`)
        }
      }
      return results
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to detect skills from ${dir}:`, err)
      }
      return []
    }
  }
}
