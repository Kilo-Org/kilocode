import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll } from "bun:test"
import { AgentPlugin } from "../src"

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

/** Writes files below `root`; objects become JSON, `{ symlink }` becomes a link to that target. */
export async function write(root: string, tree: Tree) {
  for (const [file, content] of Object.entries(tree)) {
    const target = path.join(root, file)
    await mkdir(path.dirname(target), { recursive: true })
    if (typeof content === "object" && content !== null && "symlink" in content) {
      await symlink(String(content.symlink), target)
      continue
    }
    await writeFile(target, typeof content === "string" ? content : JSON.stringify(content, null, 2))
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
