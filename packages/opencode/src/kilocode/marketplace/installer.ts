import { randomUUID } from "crypto"
import { access, mkdir, mkdtemp, readdir, realpath, rename, rm } from "fs/promises"
import path from "path"
import os from "os"
import { stringify as stringifyYaml } from "yaml"
import { applyEdits, modify, parse as parseJsonc, type ParseError as JsoncParseError } from "jsonc-parser"
import { Effect } from "effect"
import { Flock } from "@opencode-ai/core/util/flock"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import { Process } from "@/util/process"
import { Filesystem } from "@/util/filesystem"
import { installPlugin as stagePlugin, readPluginManifest } from "@/plugin/install"
import { pluginIdentity } from "./plugin-spec"
import { patchPlugin } from "./plugin-config"
import type {
  AgentInstallItem,
  MarketplaceInstallPayload,
  MarketplaceInstallResult,
  MarketplaceItemRef,
  MarketplaceRemoveResult,
  McpInstallationMethod,
  McpInstallItem,
  PluginInstallItem,
  Scope,
  SkillInstallItem,
} from "./schema"
import * as Paths from "./paths"

type Services = {
  config: Config.Interface
  agents: Agent.Interface
  skills: Skill.Interface
  directory: string
  worktree?: string
  vcs?: string
}

async function exists(file: string) {
  try {
    await access(file)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

function contains(dir: string, file: string) {
  return path.resolve(file).startsWith(path.resolve(dir) + path.sep)
}

export function isSafeId(id: string) {
  if (!id || id === "." || id.includes("..") || id.includes("/") || id.includes("\\") || id.endsWith(".")) return false
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(id)) return false
  return /^[\w\-@.]+$/.test(id)
}

function escapeJsonValue(raw: string) {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
}

export function substituteParams(template: string, params: Record<string, unknown>) {
  return Object.entries(params).reduce((text, [key, value]) => {
    const escaped = escapeJsonValue(String(value ?? ""))
    return text.replaceAll(`{{${key}}}`, escaped).replaceAll(`\${${key}}`, escaped)
  }, template)
}

export function normalizeMcpEntry(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.type === "local" || raw.type === "remote") return raw

  if (typeof raw.url === "string") {
    const { url, headers, ...rest } = raw
    const entry: Record<string, unknown> = { type: "remote", url }
    if (headers && typeof headers === "object") entry.headers = headers
    for (const key of ["enabled", "timeout", "oauth"] as const) {
      if (key in rest) entry[key] = rest[key]
    }
    return entry
  }

  if (typeof raw.command === "string") {
    const args = Array.isArray(raw.args) ? raw.args.filter((arg): arg is string => typeof arg === "string") : []
    const entry: Record<string, unknown> = { type: "local", command: [raw.command, ...args] }
    if (raw.env && typeof raw.env === "object" && Object.keys(raw.env).length > 0) entry.environment = raw.env
    for (const key of ["enabled", "timeout"] as const) {
      if (key in raw) entry[key] = raw[key]
    }
    return entry
  }

  return raw
}

function resolveMcpContent(item: McpInstallItem, opts: MarketplaceInstallPayload) {
  if (typeof item.content === "string") return item.content
  if (!Array.isArray(item.content) || item.content.length === 0) return undefined
  const name = opts.parameters?.__method
  if (typeof name === "string") {
    const found = item.content.find((method: McpInstallationMethod) => method.name === name)
    if (found) return found.content
  }
  return item.content[0]?.content
}

export function buildMcpEntry(content: string, params?: Record<string, unknown>) {
  const filtered = Object.fromEntries(Object.entries(params ?? {}).filter(([key]) => key !== "__method"))
  const replaced = Object.keys(filtered).length > 0 ? substituteParams(content, filtered) : content
  const raw = JSON.parse(replaced) as Record<string, unknown>
  return normalizeMcpEntry(raw)
}

function scopedConfig(scope: Scope, svc: Services) {
  return Effect.promise(async () => {
    const file = await Paths.configPath(scope, svc.directory, svc.worktree)
    const cfg = Bun.file(file)
    if (!(await cfg.exists())) return {}
    return (parseJsonc(await cfg.text()) ?? {}) as Record<string, Record<string, unknown>>
  })
}

function writeMcp(scope: Scope, svc: Services, id: string, entry: Record<string, unknown> | null) {
  const patch = { mcp: { [id]: entry } } as unknown as Config.Info
  if (scope === "global") return svc.config.updateGlobal(patch).pipe(Effect.asVoid)
  return svc.config.update(patch)
}

function removeAgentConfig(scope: Scope, svc: Services, id: string) {
  const patch = { agent: { [id]: null } } as unknown as Config.Info
  if (scope === "global") return svc.config.updateGlobal(patch).pipe(Effect.asVoid)
  return svc.config.update(patch)
}

function installMcp(svc: Services, item: McpInstallItem, opts: MarketplaceInstallPayload, scope: Scope) {
  return Effect.gen(function* () {
    const cfg = yield* scopedConfig(scope, svc)
    if (cfg.mcp?.[item.id])
      return { success: false, slug: item.id, error: "MCP server already installed. Remove it first." }

    const content = resolveMcpContent(item, opts)
    if (!content) return { success: false, slug: item.id, error: "No installation content for MCP server" }

    // buildMcpEntry parses JSON and can throw; run it inside the effect so a bad
    // config surfaces as the friendly failure below instead of a 500-level defect.
    return yield* Effect.try({
      try: () => buildMcpEntry(content, opts.parameters),
      catch: (err) => (err instanceof Error ? err : new Error(String(err))),
    }).pipe(
      Effect.flatMap((entry) => writeMcp(scope, svc, item.id, entry)),
      Effect.as({ success: true, slug: item.id } as MarketplaceInstallResult),
      Effect.catch((err: unknown) =>
        Effect.succeed({
          success: false,
          slug: item.id,
          error: `Invalid MCP config: ${err instanceof Error ? err.message : String(err)}`,
        }),
      ),
    )
  })
}

function installAgent(svc: Services, item: AgentInstallItem, scope: Scope) {
  return Effect.gen(function* () {
    if (!isSafeId(item.id)) return { success: false, slug: item.id, error: "Invalid agent id" }

    const dir = Paths.agentsDir(scope, svc.directory)
    const file = path.join(dir, `${item.id}.md`)
    if (!contains(dir, file)) return { success: false, slug: item.id, error: "Invalid agent id" }

    const existing = yield* Effect.promise(() => exists(file))
    if (existing) return { success: false, slug: item.id, error: "Agent already installed. Remove it first." }

    const { prompt, ...front } = item.content
    yield* Effect.promise(async () => {
      await mkdir(dir, { recursive: true })
      await Bun.write(file, `---\n${stringifyYaml(front).trimEnd()}\n---\n\n${prompt}\n`)
    })

    const cfg = yield* scopedConfig(scope, svc)
    if (cfg.agent?.[item.id]) yield* removeAgentConfig(scope, svc, item.id)
    return { success: true, slug: item.id, filePath: file, line: 1 }
  })
}

export async function findEscapedPaths(dir: string): Promise<string[]> {
  const root = path.resolve(dir)
  const escaped: string[] = []

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const item of entries) {
      const full = path.resolve(current, item.name)
      if (!full.startsWith(root + path.sep) && full !== root) {
        escaped.push(full)
        continue
      }
      if (item.isSymbolicLink()) {
        const target = await realpath(full)
        if (!target.startsWith(root + path.sep) && target !== root) {
          escaped.push(full)
          continue
        }
      }
      if (item.isDirectory()) await walk(full)
    }
  }

  await walk(dir)
  return escaped
}

function installSkill(item: SkillInstallItem, scope: Scope, directory: string) {
  return Effect.promise(async (): Promise<MarketplaceInstallResult> => {
    if (!item.content) return { success: false, slug: item.id, error: "Skill has no tarball URL" }
    if (!isSafeId(item.id)) return { success: false, slug: item.id, error: "Invalid skill id" }

    const base = Paths.skillsDir(scope, directory)
    const dir = path.join(base, item.id)
    if (!contains(base, dir)) return { success: false, slug: item.id, error: "Invalid skill id" }
    if (await exists(dir))
      return { success: false, slug: item.id, error: "Skill already installed. Uninstall it before installing again." }

    await mkdir(base, { recursive: true })
    const staging = await mkdtemp(path.join(base, `.staging-${item.id}-`))
    const archive = `kilo-skill-${item.id}-${randomUUID()}.tar.gz`
    const tarball = path.join(os.tmpdir(), archive)
    const inline = item.content.startsWith("data:")
    const data = inline ? item.content.match(/^data:[^,]*;base64,(.*)$/) : null

    try {
      if (inline) {
        // Only base64 data URLs are supported; fail closed rather than falling
        // through to fetch() with a data: URL that will not resolve.
        if (!data) return { success: false, slug: item.id, error: "Unsupported skill archive data URL" }
        await Bun.write(tarball, Buffer.from(data[1], "base64"))
      } else {
        const response = await fetch(item.content)
        if (!response.ok) return { success: false, slug: item.id, error: `Download failed: ${response.status}` }
        await Bun.write(tarball, Buffer.from(await response.arrayBuffer()))
      }
      // Pass the archive as a bare filename with cwd at its directory: GNU tar (on Windows)
      // otherwise misreads a `C:\...` archive path as a remote `host:path` and fails to extract.
      await Process.run(["tar", "-xzf", archive, "--strip-components=1", "-C", staging], { cwd: os.tmpdir() })

      const escaped = await findEscapedPaths(staging)
      if (escaped.length > 0) return { success: false, slug: item.id, error: "Skill archive contains unsafe paths" }
      if (!(await exists(path.join(staging, "SKILL.md"))))
        return { success: false, slug: item.id, error: "Extracted archive missing SKILL.md" }

      await rename(staging, dir)
      return { success: true, slug: item.id, filePath: path.join(dir, "SKILL.md"), line: 1 }
    } catch (err) {
      if (await exists(dir))
        return {
          success: false,
          slug: item.id,
          error: "Skill already installed. Uninstall it before installing again.",
        }
      return { success: false, slug: item.id, error: String(err) }
    } finally {
      await Promise.all([
        rm(staging, { recursive: true, force: true }).catch((err) =>
          console.warn("Failed to clean marketplace staging directory", err),
        ),
        rm(tarball, { force: true }).catch((err) => console.warn("Failed to clean marketplace tarball", err)),
      ])
    }
  })
}

function errorText(err: unknown) {
  if (!err || typeof err !== "object") return String(err)
  if ("cause" in err && err.cause instanceof Error) return err.cause.message
  return err instanceof Error ? err.message : String(err)
}

function installPlugin(svc: Services, item: PluginInstallItem, scope: Scope) {
  return Effect.promise(async (): Promise<MarketplaceInstallResult> => {
    try {
      const spec = item.content.trim()
      if (!spec) return { success: false, slug: item.id, error: "Plugin has no package spec" }

      // Installed state is keyed by catalog id, so it must equal the resolved
      // plugin identity or detection and removal cannot find the entry again.
      const identity = pluginIdentity(spec)
      if (!identity) return { success: false, slug: item.id, error: `Plugin spec ${spec} is not a valid package` }
      if (identity !== item.id) {
        return {
          success: false,
          slug: item.id,
          error: `Plugin id ${item.id} must match the plugin identity ${identity}`,
        }
      }

      const staged = await stagePlugin(spec)
      if (!staged.ok) return { success: false, slug: item.id, error: errorText(staged.error) }

      const manifest = await readPluginManifest(staged.target)
      if (!manifest.ok) {
        const error =
          manifest.code === "manifest_no_targets"
            ? `Plugin ${spec} does not expose a server or tui entrypoint`
            : `Could not read plugin package manifest: ${errorText(manifest.error)}`
        return { success: false, slug: item.id, error }
      }

      const out = await patchPlugin({
        spec,
        targets: manifest.targets,
        global: scope === "global",
        vcs: svc.vcs,
        worktree: svc.worktree ?? svc.directory,
        directory: svc.directory,
      })
      if (!out.success) return { success: false, slug: item.id, error: out.error }

      const file = out.files.at(0)
      return { success: true, slug: item.id, filePaths: out.files, ...(file ? { filePath: file, line: 1 } : {}) }
    } catch (err) {
      return { success: false, slug: item.id, error: errorText(err) }
    }
  })
}

function lockPath(file: string) {
  return path.join(path.dirname(file), path.basename(file).replace(/\.jsonc?$/, ""))
}

async function stripPluginFromFile(file: string, identity: string) {
  // Take the same lock runtime-backed installs use so a concurrent install and
  // remove cannot interleave and drop an entry.
  await using _ = await Flock.acquire(`plug-config:${Filesystem.resolve(lockPath(file))}`)
  const text = await Bun.file(file)
    .text()
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined
      throw err
    })
  if (text === undefined) return "missing"
  const errors: JsoncParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new Error("Invalid JSON; file left unchanged and plugin removal could not be verified")
  const list =
    data && typeof data === "object" && Array.isArray((data as { plugin?: unknown }).plugin)
      ? (data as { plugin: unknown[] }).plugin
      : undefined
  if (!list) return "missing"
  const next = list.filter((entry) => pluginIdentity(entry) !== identity)
  if (next.length === list.length) return "missing"
  const out = applyEdits(
    text,
    modify(text, ["plugin"], next, { formattingOptions: { tabSize: 2, insertSpaces: true } }),
  )
  await Filesystem.write(file, out)
  return "removed"
}

function removePlugin(svc: Services, item: MarketplaceItemRef, scope: Scope) {
  return Effect.promise(async (): Promise<MarketplaceRemoveResult> => {
    const identity = pluginIdentity(item.id) ?? item.id
    const removed: string[] = []
    const errors: string[] = []
    for (const file of Paths.pluginFiles(scope, svc.directory, svc.worktree)) {
      try {
        if ((await stripPluginFromFile(file, identity)) === "removed") removed.push(file)
      } catch (err) {
        errors.push(`${file}: ${errorText(err)}`)
      }
    }
    if (errors.length) {
      const changed = removed.length ? ` Removed from: ${removed.join(", ")}.` : ""
      return {
        success: false,
        slug: item.id,
        error: `Plugin removal incomplete.${changed} Could not verify removal from: ${errors.join("; ")}`,
      }
    }
    return { success: true, slug: item.id }
  })
}

export function install(svc: Services, payload: MarketplaceInstallPayload) {
  const scope = payload.target ?? "project"
  if (payload.item.type === "mcp") return installMcp(svc, payload.item, payload, scope)
  if (payload.item.type === "agent") return installAgent(svc, payload.item, scope)
  if (payload.item.type === "plugin") return installPlugin(svc, payload.item, scope)
  return installSkill(payload.item, scope, svc.directory)
}

function removeMcp(svc: Services, item: MarketplaceItemRef, scope: Scope) {
  return Effect.gen(function* () {
    const cfg = yield* scopedConfig(scope, svc)
    if (!cfg.mcp?.[item.id]) return { success: true, slug: item.id }
    yield* writeMcp(scope, svc, item.id, null)
    return { success: true, slug: item.id }
  })
}

function removeAgent(svc: Services, item: MarketplaceItemRef, scope: Scope) {
  return Effect.gen(function* () {
    if (!isSafeId(item.id)) return { success: false, slug: item.id, error: "Invalid agent id" }
    const dir = Paths.agentsDir(scope, svc.directory)
    const file = path.join(dir, `${item.id}.md`)
    if (!contains(dir, file)) return { success: false, slug: item.id, error: "Invalid agent id" }
    yield* Effect.promise(async () => {
      await rm(file, { force: true })
    })
    const cfg = yield* scopedConfig(scope, svc)
    if (cfg.agent?.[item.id]) yield* removeAgentConfig(scope, svc, item.id)
    return { success: true, slug: item.id }
  })
}

function removeSkill(svc: Services, item: MarketplaceItemRef, scope: Scope) {
  return Effect.gen(function* () {
    // Marketplace skills are installed into <skillsDir>/<item.id> and that whole
    // directory is installer-owned. Resolve by id (as installSkill does) and remove
    // the directory, not just SKILL.md — leaving the directory behind blocks reinstall
    // while detection reports the skill as absent. Keying on the registry name would
    // silently no-op when the frontmatter name differs from the install id.
    if (!isSafeId(item.id)) return { success: false, slug: item.id, error: "Invalid skill id" }
    const base = Paths.skillsDir(scope, svc.directory)
    const dir = path.join(base, item.id)
    if (!contains(base, dir)) return { success: false, slug: item.id, error: "Invalid skill id" }

    const present = yield* Effect.promise(() => exists(dir))
    if (!present) return { success: true, slug: item.id }

    return yield* Effect.tryPromise({
      try: () => rm(dir, { recursive: true, force: true }),
      catch: (err) => err,
    }).pipe(
      Effect.as({ success: true, slug: item.id }),
      Effect.catch((err) =>
        Effect.succeed({ success: false, slug: item.id, error: err instanceof Error ? err.message : String(err) }),
      ),
    )
  })
}

export function remove(svc: Services, item: MarketplaceItemRef, scope: Scope) {
  if (item.type === "mcp") return removeMcp(svc, item, scope)
  if (item.type === "agent") return removeAgent(svc, item, scope)
  if (item.type === "plugin") return removePlugin(svc, item, scope)
  return removeSkill(svc, item, scope)
}
