import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll } from "bun:test"
import { AgentPlugin } from "../../src/agent-plugins/plugin"

export const PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
export const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"

const created: string[] = []
afterAll(() => Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true }))))

/** A fresh resolved temporary directory, removed after the test file. */
export async function temp() {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "agent-plugins-")))
  created.push(dir)
  return dir
}

export type Tree = Record<string, string | object | { symlink: string }>

/**
 * Writes files below `root`; objects become JSON, `{ symlink }` becomes a link to that target. Links are created
 * after the files, with the target's kind, because Windows needs a directory link for a directory target.
 */
export async function write(root: string, tree: Tree) {
  const entries = Object.entries(tree)
  const links = entries.flatMap(([file, content]): [string, string][] =>
    typeof content === "object" && content !== null && "symlink" in content ? [[file, String(content.symlink)]] : [],
  )
  for (const [file, content] of entries) {
    if (links.some(([link]) => link === file)) continue
    const target = path.join(root, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, typeof content === "string" ? content : JSON.stringify(content, null, 2))
  }
  for (const [file, to] of links) {
    const target = path.join(root, file)
    await mkdir(path.dirname(target), { recursive: true })
    const info = await stat(path.resolve(path.dirname(target), to)).catch(() => undefined)
    await symlink(to, target, info?.isDirectory() ? "dir" : "file")
  }
}

/** A plugin directory with a valid minimal manifest unless the tree overrides `plugin.json`. */
export async function plugin(tree: Tree = {}, name = "demo") {
  const base = await temp()
  const root = path.join(base, "plugin")
  await mkdir(root)
  await write(root, { "plugin.json": { $schema: PLUGIN_SCHEMA, name }, ...tree })
  return { base, root, data: path.join(base, "data") }
}

export function skill(name: string, description = `The ${name} skill.`, extra = "") {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n# ${name}\n\nBody of ${name}.\n`
}

export function mcp(servers: Record<string, unknown>, schema = MCP_SCHEMA) {
  return { $schema: schema, mcpServers: servers }
}

export async function load(tree: Tree = {}, options: Partial<AgentPlugin.Options> = {}) {
  const fixture = await plugin(tree)
  return { ...fixture, loaded: await AgentPlugin.load(fixture.root, { dataRoot: fixture.data, ...options }) }
}

export function codes(loaded: AgentPlugin.Loaded) {
  return loaded.diagnostics.map((diagnostic) => diagnostic.code)
}
