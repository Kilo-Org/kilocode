import * as fs from "fs/promises"
import * as path from "path"
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
              this.detectFromConfig(this.paths.configPath("project", workspace)),
              this.detectSkills(this.paths.skillsDir("project", workspace)),
            ])
          ).flat(),
        )
      : {}

    const global = Object.fromEntries(
      (
        await Promise.all([
          this.detectFromConfig(this.paths.configPath("global")),
          this.detectSkills(this.paths.skillsDir("global")),
        ])
      ).flat(),
    )

    return { project, global }
  }

  /** Read mcp and agent entries from a kilo.json config file. */
  private async detectFromConfig(filepath: string): Promise<Entry[]> {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      const parsed = JSON.parse(content)
      const entries: Entry[] = []

      if (parsed?.mcp && typeof parsed.mcp === "object") {
        for (const key of Object.keys(parsed.mcp)) {
          entries.push([key, { type: "mcp" }])
        }
      }

      if (parsed?.agent && typeof parsed.agent === "object") {
        for (const key of Object.keys(parsed.agent)) {
          entries.push([key, { type: "mode" }])
        }
      }

      return entries
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to detect items from ${filepath}:`, err)
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
