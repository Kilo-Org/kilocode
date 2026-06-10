import fs from "fs/promises"
import path from "path"
import { Config } from "@/config/config"
import { AgentBuilder } from "@/kilocode/agent/builder"
import { Process } from "@/util/process"
import { Cause, Effect } from "effect"
import type { AgentItem, InstallPayload, Item, McpItem, Method, SkillItem, Target } from "./types"
import * as Paths from "./paths"

type Agent = NonNullable<Config.Info["agent"]>[string]
type Mcp = NonNullable<Config.Info["mcp"]>[string]
type Patch = Omit<Config.Info, "agent" | "mcp"> & {
  agent?: Record<string, Agent | null>
  mcp?: Record<string, Mcp | null>
}

function safe(id: string) {
  if (!id || id === "." || id.includes("..") || id.includes("/") || id.includes("\\") || id.endsWith(".")) return false
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(id)) return false
  return /^[\w\-@.]+$/.test(id)
}

function json(raw: string) {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
}

function substitute(template: string, params: Record<string, unknown>) {
  const filtered = Object.fromEntries(Object.entries(params).filter(([key]) => key !== "__method"))
  return Object.entries(filtered).reduce((text, [key, value]) => {
    const escaped = json(String(value ?? ""))
    return text.replaceAll(`{{${key}}}`, escaped).replaceAll(`\${${key}}`, escaped)
  }, template)
}

function normalize(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.type === "local" || raw.type === "remote") return raw
  if (typeof raw.url === "string") {
    const entry: Record<string, unknown> = { type: "remote", url: raw.url }
    if (raw.headers && typeof raw.headers === "object") entry.headers = raw.headers
    for (const key of ["enabled", "timeout", "oauth"] as const) if (key in raw) entry[key] = raw[key]
    return entry
  }
  if (typeof raw.command === "string") {
    const args = Array.isArray(raw.args) ? raw.args : []
    const entry: Record<string, unknown> = { type: "local", command: [raw.command, ...args] }
    if (raw.env && typeof raw.env === "object" && Object.keys(raw.env).length > 0) entry.environment = raw.env
    for (const key of ["enabled", "timeout"] as const) if (key in raw) entry[key] = raw[key]
    return entry
  }
  return raw
}

function content(item: McpItem, params?: Record<string, unknown>) {
  if (typeof item.content === "string") return item.content
  if (!Array.isArray(item.content) || item.content.length === 0) return undefined
  const name = params?.__method
  if (typeof name !== "string") return item.content[0].content
  return item.content.find((method: Method) => method.name === name)?.content ?? item.content[0].content
}

function entry(item: McpItem, params?: Record<string, unknown>): Mcp | undefined {
  const raw = content(item, params)
  if (!raw) return undefined
  return normalize(JSON.parse(params ? substitute(raw, params) : raw) as Record<string, unknown>) as Mcp
}

function patchMcp(id: string, value: Mcp | null): Patch {
  return { mcp: { [id]: value } }
}

function patchAgent(id: string): Patch {
  return { agent: { [id]: null } }
}

const update = Effect.fn("Marketplace.updateConfig")(function* (scope: Target, patch: Patch) {
  const cfg = yield* Config.Service
  // Config.patchJsonc treats null as a deletion tombstone; Config.Info only represents loaded config.
  const tombstone = patch as Config.Info
  if (scope === "project") return yield* cfg.update(tombstone)
  yield* cfg.updateGlobal(tombstone, { dispose: false })
})

async function unlink(file: string) {
  await fs.unlink(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err
  })
}

async function escaped(dir: string): Promise<string[]> {
  const root = path.resolve(dir)
  const out: string[] = []
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const item of entries) {
      const full = path.resolve(current, item.name)
      if (!inside(full, root)) {
        out.push(full)
        continue
      }
      if (item.isSymbolicLink()) {
        const real = await fs.realpath(full).catch(() => undefined)
        if (!real) {
          out.push(full)
          continue
        }
        if (!inside(real, root)) {
          out.push(full)
          continue
        }
      }
      if (item.isDirectory()) await walk(full)
    }
  }
  await walk(dir)
  return out
}

function inside(file: string, dir: string) {
  const base = path.resolve(dir)
  const full = path.resolve(file)
  return full === base || full.startsWith(base + path.sep)
}

async function exists(file: string) {
  return fs.stat(file).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return false
      throw err
    },
  )
}

export const install = Effect.fn("Marketplace.install")(function* (
  item: Item,
  payload: InstallPayload,
  ctx: Paths.Ctx,
) {
  const scope = payload.target ?? "project"
  if (scope === "project" && !ctx.directory)
    return { success: false, slug: payload.id, error: "No workspace directory for project-scope install" }
  if (item.type === "mcp") return yield* installMcp(item, payload, scope)
  if (item.type === "agent") return yield* installAgent(item, scope, ctx)
  return yield* installSkill(item, scope, ctx)
})

const installMcp = Effect.fn("Marketplace.installMcp")(function* (
  item: McpItem,
  payload: InstallPayload,
  scope: Target,
) {
  const cfg = yield* Config.Service
  const current = scope === "project" ? yield* cfg.get() : yield* cfg.getGlobal()
  if (current.mcp?.[item.id])
    return { success: false, slug: item.id, error: "MCP server already installed. Remove it first." }
  const built = yield* Effect.try({
    try: () => entry(item, payload.parameters),
    catch: (err) => String(err),
  }).pipe(Effect.match({ onFailure: (err) => ({ error: `Invalid MCP config: ${err}` }), onSuccess: (value) => value }))
  if (!built) return { success: false, slug: item.id, error: "No installation content for MCP server" }
  if ("error" in built) return { success: false, slug: item.id, error: String(built.error) }
  yield* update(scope, patchMcp(item.id, built))
  return { success: true, slug: item.id }
})

const installAgent = Effect.fn("Marketplace.installAgent")(function* (item: AgentItem, scope: Target, ctx: Paths.Ctx) {
  if (!safe(item.id)) return { success: false, slug: item.id, error: "Invalid agent id" }
  const dir = Paths.agent(scope, ctx)
  const file = path.join(dir, `${item.id}.md`)
  if (!inside(file, dir)) return { success: false, slug: item.id, error: "Invalid agent id" }
  const duplicate = yield* Effect.promise(() =>
    Promise.all(Paths.agents(scope, ctx).map((dir) => exists(path.join(dir, `${item.id}.md`)))),
  )
  if (duplicate.some(Boolean))
    return { success: false, slug: item.id, error: "Agent already installed. Remove it first." }
  const output = yield* Effect.promise(() =>
    AgentBuilder.save({ directory: ctx.directory, worktree: ctx.worktree }, { id: item.id, scope, ...item.content }),
  )
  yield* update(scope, patchAgent(item.id))
  return { success: true, slug: item.id, filePath: output.path, line: 1 }
})

const installSkill = Effect.fn("Marketplace.installSkill")(function* (item: SkillItem, scope: Target, ctx: Paths.Ctx) {
  if (!item.content) return { success: false, slug: item.id, error: "Skill has no tarball URL" }
  if (!safe(item.id)) return { success: false, slug: item.id, error: "Invalid skill id" }
  const base = Paths.skills(scope, ctx)
  const dir = path.join(base, item.id)
  if (!inside(dir, base)) return { success: false, slug: item.id, error: "Invalid skill id" }
  const duplicate = yield* Effect.promise(() =>
    Promise.all(Paths.skillRoots(scope, ctx).map((base) => exists(path.join(base, item.id)))),
  )
  if (duplicate.some(Boolean))
    return { success: false, slug: item.id, error: "Skill already installed. Uninstall it before installing again." }
  const stamp = Date.now()
  const archive = `.staging-${item.id}-${stamp}.tar.gz`
  const tarball = path.join(base, archive)
  const stage = `.staging-${item.id}-${stamp}`
  const staging = path.join(base, `.staging-${item.id}-${stamp}`)
  return yield* Effect.tryPromise(async () => {
    await fs.mkdir(base, { recursive: true })
    const response = await fetch(item.content)
    if (!response.ok) return { success: false, slug: item.id, error: `Download failed: ${response.status}` }
    await fs.writeFile(tarball, Buffer.from(await response.arrayBuffer()))
    await fs.mkdir(staging, { recursive: true })
    await Process.run(["tar", "-xzf", archive, "--strip-components=1", "-C", stage], { cwd: base })
    if ((await escaped(staging)).length > 0)
      return { success: false, slug: item.id, error: "Skill archive contains unsafe paths" }
    if (!(await Bun.file(path.join(staging, "SKILL.md")).exists()))
      return { success: false, slug: item.id, error: "Extracted archive missing SKILL.md" }
    await fs.rename(staging, dir)
    return { success: true, slug: item.id, filePath: path.join(dir, "SKILL.md"), line: 1 }
  }).pipe(
    Effect.catch((err) => {
      const cause = Cause.isUnknownError(err) ? err.cause : err
      return Effect.succeed({ success: false, slug: item.id, error: String(cause) })
    }),
    Effect.ensuring(
      Effect.promise(() =>
        Promise.all([fs.rm(staging, { recursive: true, force: true }), fs.rm(tarball, { force: true })]).then(
          () => undefined,
        ),
      ),
    ),
  )
})

export const remove = Effect.fn("Marketplace.remove")(function* (item: Item, scope: Target, ctx: Paths.Ctx) {
  if (item.type === "mcp") return yield* removeMcp(item, scope, ctx)
  if (item.type === "agent") return yield* removeAgent(item, scope, ctx)
  return yield* removeSkill(item, scope, ctx)
})

const removeMcp = Effect.fn("Marketplace.removeMcp")(function* (item: McpItem, scope: Target, ctx: Paths.Ctx) {
  yield* update(scope, patchMcp(item.id, null))
  return { success: true, slug: item.id }
})

const removeAgent = Effect.fn("Marketplace.removeAgent")(function* (item: AgentItem, scope: Target, ctx: Paths.Ctx) {
  if (!safe(item.id)) return { success: false, slug: item.id, error: "Invalid agent id" }
  for (const dir of Paths.agents(scope, ctx)) {
    const file = path.join(dir, `${item.id}.md`)
    if (!inside(file, dir)) return { success: false, slug: item.id, error: "Invalid agent id" }
    yield* Effect.promise(() => unlink(file))
  }
  yield* update(scope, patchAgent(item.id))
  return { success: true, slug: item.id }
})

const removeSkill = Effect.fn("Marketplace.removeSkill")(function* (item: SkillItem, scope: Target, ctx: Paths.Ctx) {
  if (!safe(item.id)) return { success: false, slug: item.id, error: "Invalid skill id" }
  for (const base of Paths.skillRoots(scope, ctx)) {
    const dir = path.join(base, item.id)
    if (!inside(dir, base)) return { success: false, slug: item.id, error: "Invalid skill id" }
    yield* Effect.promise(() => fs.rm(dir, { recursive: true, force: true }))
  }
  return { success: true, slug: item.id }
})
