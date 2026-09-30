import path from "path"
import { readdir } from "fs/promises"
import { parse as parseJsonc } from "jsonc-parser"
import * as Log from "@opencode-ai/core/util/log"
import type { Skill } from "@/skill"
import type { MarketplaceInstalledMetadata, Scope } from "./schema"
import * as Paths from "./paths"
import * as Companions from "./companions"
import { pluginIdentity } from "./plugin-spec"

const log = Log.create({ service: "marketplace" })

type Entry = [string, { type: string }]

type DetectInput = {
  directory: string
  worktree?: string
  skills?: readonly Pick<Skill.Info, "name" | "location">[]
}

const TYPES = ["mcp", "agent", "skill", "plugin"] as const

function entry(id: string, type: (typeof TYPES)[number]): Entry {
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
    // A missing directory is expected. Any other error (EACCES, ENOTDIR, ...) should
    // degrade this one source to empty rather than fail the whole catalog endpoint.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") log.warn("agent detection failed", { scope, dir, err })
    return []
  }
}

async function mcpFiles(scope: Scope, directory: string, worktree?: string): Promise<Entry[]> {
  const dir = await Paths.mcpsDir(scope, directory, worktree)
  const files = await readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") log.warn("MCP receipt detection failed", { scope, dir, err })
    return [] as string[]
  })
  const result = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file): Promise<Entry[]> => {
        const id = path.basename(file, ".json")
        try {
          return (await Companions.read(scope, directory, id, worktree)) ? [entry(id, "mcp")] : []
        } catch (err) {
          log.warn("MCP receipt detection failed", { scope, file, err })
          return []
        }
      }),
  )
  return result.flat()
}

async function configEntries(scope: Scope, directory: string, worktree?: string): Promise<Entry[]> {
  const file = await Paths.configPath(scope, directory, worktree)
  try {
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
  } catch (err) {
    // Degrade an unreadable/malformed config to empty so detection still returns
    // partial installed metadata instead of turning the listing into a 500.
    log.warn("config detection failed", { scope, file, err })
    return []
  }
}

async function detectScope(scope: Scope, input: DetectInput): Promise<Record<string, { type: string }>> {
  return Object.fromEntries([
    ...(await agentFiles(scope, input.directory)),
    ...(await configEntries(scope, input.directory, input.worktree)),
    // Keep failed-install receipts visible so users can retry cleanup without the catalog.
    ...(await mcpFiles(scope, input.directory, input.worktree)),
    ...(await pluginEntries(scope, input)),
    ...skillEntries(input.skills, input.directory, scope === "project"),
  ])
}

async function readPluginList(file: string): Promise<unknown[]> {
  try {
    const cfg = Bun.file(file)
    if (!(await cfg.exists())) return []
    const parsed = parseJsonc(await cfg.text())
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { plugin?: unknown }).plugin)) {
      return (parsed as { plugin: unknown[] }).plugin
    }
    return []
  } catch (err) {
    log.warn("plugin detection failed", { file, err })
    return []
  }
}

async function pluginEntries(scope: Scope, input: DetectInput): Promise<Entry[]> {
  const out: Entry[] = []
  for (const file of Paths.pluginFiles(scope, input.directory, input.worktree)) {
    for (const spec of await readPluginList(file)) {
      const name = pluginIdentity(spec)
      if (name) out.push(entry(name, "plugin"))
    }
  }
  return out
}

export async function detect(input: DetectInput): Promise<MarketplaceInstalledMetadata> {
  const [project, global] = await Promise.all([detectScope("project", input), detectScope("global", input)])
  return { project, global }
}
