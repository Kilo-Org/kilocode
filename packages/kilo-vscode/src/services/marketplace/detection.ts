import * as fs from "fs/promises"
import * as path from "path"
import type { MarketplaceInstalledMetadata } from "./types"
import { MarketplacePaths } from "./paths"

type Entry = [string, { type: string }]

function entry(id: string, type: "agent" | "mcp" | "skill"): Entry {
  return [`${type}:${id}`, { type }]
}

export interface CliSkill {
  name: string
  location: string
}

export class InstallationDetector {
  constructor(private paths: MarketplacePaths) {}

  /**
   * Detect installed marketplace items.
   *
   * Agents are detected from .kilo/agents/*.md files.
   * MCP servers and modes are detected from kilo.json config files.
   * Skills come from the CLI backend (via GET /skill), which is the
   * authoritative source — it scans all skill directories.
   */
  async detect(workspace?: string, skills?: CliSkill[]): Promise<MarketplaceInstalledMetadata> {
    const project = workspace
      ? Object.fromEntries([
          ...(await this.detectAgentFiles("project", workspace)),
          ...(await this.detectFromConfig(this.paths.configPath("project", workspace))),
          ...this.skillEntries(skills, workspace, true),
        ])
      : {}

    const global = Object.fromEntries([
      ...(await this.detectAgentFiles("global")),
      ...(await this.detectFromConfig(this.paths.configPath("global"))),
      ...this.skillEntries(skills, workspace, false),
    ])

    return { project, global }
  }

  private isProjectSkill(location: string, workspace: string): boolean {
    const prefix = workspace.endsWith(path.sep) ? workspace : workspace + path.sep
    return location.startsWith(prefix)
  }

  private skillEntries(skills: CliSkill[] | undefined, workspace: string | undefined, project: boolean): Entry[] {
    if (!skills) return []
    return skills
      .filter((s) =>
        project
          ? !!workspace && this.isProjectSkill(s.location, workspace)
          : !workspace || !this.isProjectSkill(s.location, workspace),
      )
      .map((skill) => entry(skill.name, "skill"))
  }

  /** Scan .kilo/agents/*.md files to detect installed marketplace agents. */
  private async detectAgentFiles(scope: "project" | "global", workspace?: string): Promise<Entry[]> {
    const dir = this.paths.agentsDir(scope, workspace)
    try {
      const files = await fs.readdir(dir)
      return files.filter((file) => file.endsWith(".md")).map((file) => entry(path.basename(file, ".md"), "agent"))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to detect agent files from ${dir}:`, err)
      }
      return []
    }
  }

  /** Read mcp and agent entries from a kilo.json config file. */
  private async detectFromConfig(filepath: string): Promise<Entry[]> {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      const parsed = JSON.parse(content)
      const entries: Entry[] = []

      if (parsed?.mcp && typeof parsed.mcp === "object") {
        for (const key of Object.keys(parsed.mcp)) {
          entries.push(entry(key, "mcp"))
        }
      }

      if (parsed?.agent && typeof parsed.agent === "object") {
        for (const key of Object.keys(parsed.agent)) {
          entries.push(entry(key, "agent"))
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
}
