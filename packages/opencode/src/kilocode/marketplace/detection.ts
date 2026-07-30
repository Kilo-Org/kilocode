import path from "path"
import { readdir } from "fs/promises"
import { parse as parseJsonc } from "jsonc-parser"
import type { Skill } from "@/skill"
import type { MarketplaceInstalledMetadata, Scope } from "./schema"
import * as Paths from "./paths"

type Entry = [string, { type: string }]

type DetectInput = {
  directory: string
  worktree?: string
  skills?: readonly Pick<Skill.Info, "name" | "location">[]
}

function entry(id: string, type: "agent" | "mcp" | "skill"): Entry {
  return [`${type}:${id}`, { type }]
}

function projectSkill(location: string, directory: string) {
  const prefix = directory.endsWith(path.sep) ? directory : directory + path.sep
  return location.startsWith(prefix)
}

function skillEntries(skills: DetectInput["skills"], directory: string, project: boolean) {
  if (!skills) return []
  return skills
    .filter((skill) => (project ? projectSkill(skill.location, directory) : !projectSkill(skill.location, directory)))
    .map((skill) => entry(skill.name, "skill"))
}

async function agentFiles(scope: Scope, directory: string): Promise<Entry[]> {
  const dir = Paths.agentsDir(scope, directory)
  try {
    const files = await readdir(dir)
    return files.filter((file) => file.endsWith(".md")).map((file) => entry(path.basename(file, ".md"), "agent"))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    return []
  }
}

async function configEntries(scope: Scope, directory: string, worktree?: string): Promise<Entry[]> {
  const file = await Paths.configPath(scope, directory, worktree)
  const cfg = Bun.file(file)
  if (!(await cfg.exists())) return []

  const parsed = parseJsonc(await cfg.text())
  const out: Entry[] = []
  if (parsed?.mcp && typeof parsed.mcp === "object") {
    for (const key of Object.keys(parsed.mcp)) out.push(entry(key, "mcp"))
  }
  if (parsed?.agent && typeof parsed.agent === "object") {
    for (const key of Object.keys(parsed.agent)) out.push(entry(key, "agent"))
  }
  return out
}

async function detectScope(scope: Scope, input: DetectInput): Promise<Record<string, { type: string }>> {
  return Object.fromEntries([
    ...(await agentFiles(scope, input.directory)),
    ...(await configEntries(scope, input.directory, input.worktree)),
    ...skillEntries(input.skills, input.directory, scope === "project"),
  ])
}

export async function detect(input: DetectInput): Promise<MarketplaceInstalledMetadata> {
  const [project, global] = await Promise.all([detectScope("project", input), detectScope("global", input)])
  return { project, global }
}
