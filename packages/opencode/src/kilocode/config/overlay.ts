import path from "path"
import { existsSync } from "fs"
import { Schema } from "effect"
import z from "zod"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { ConfigAgent } from "@/config/agent"
import { Config } from "@/config/config"
import { ConfigParse } from "@/config/parse"
import { ConfigVariable } from "@/config/variable"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"
import { KilocodeConfig } from "./config"
import { KilocodeConfigSources } from "./sources"

export namespace KilocodeConfigOverlay {
  const log = Log.create({ service: "kilocode.config.overlay" })

  export const Scope = z.enum(["global", "project"])
  export type Scope = z.infer<typeof Scope>

  export const Origin = z.enum(["project", "global", "system", "default"])
  export type Origin = z.infer<typeof Origin>

  export const Query = z.object({
    scope: Scope.default("project"),
  })
  export type Query = z.infer<typeof Query>

  export const Patch = z.object({
    scope: Scope.default("project"),
    set: z.record(z.string(), z.unknown()).optional(),
    unset: z.array(z.array(z.string()).min(1)).optional(),
  })
  export type Patch = z.infer<typeof Patch>

  export const Resolved = z.object({
    key: z.string(),
    path: z.array(z.string()),
    value: z.unknown().optional(),
    global: z.unknown().optional(),
    local: z.unknown().optional(),
    source: Origin,
    inherited: z.boolean(),
    overridden: z.boolean(),
    editable: z.boolean(),
    reason: z.string().optional(),
  })
  export type Resolved = z.infer<typeof Resolved>

  export const Result = z.object({
    scope: Scope,
    effective: z.custom<Config.Info>(Schema.is(Config.Info)),
    global: z.custom<Config.Info>(Schema.is(Config.Info)),
    project: z.custom<Config.Info>(Schema.is(Config.Info)),
    sources: z.array(KilocodeConfigSources.Source),
    targets: z.object({
      global: z.string().optional(),
      project: z.string().optional(),
      active: z.string().optional(),
    }),
    fields: z.record(z.string(), Resolved),
    collections: z.record(z.string(), z.array(Resolved)),
  })
  export type Result = z.infer<typeof Result>

  export type Input = {
    directory: string
    worktree?: string
    scope: Scope
    effective: Config.Info
    global: Config.Info
    sources: KilocodeConfigSources.Source[]
  }

  const files = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"] as const
  const dirs = [".kilocode", ".kilo"] as const

  const fieldPaths = [
    ["model"],
    ["small_model"],
    ["hide_prompt_training_models"],
    ["default_agent"],
    ["snapshot"],
    ["share"],
    ["autoupdate"],
    ["enabled_providers"],
    ["disabled_providers"],
    ["watcher", "ignore"],
    ["instructions"],
    ["indexing", "enabled"],
    ["indexing", "provider"],
    ["indexing", "model"],
    ["indexing", "dimension"],
    ["indexing", "vectorStore"],
    ["indexing", "kilo", "apiKey"],
    ["indexing", "kilo", "baseUrl"],
    ["indexing", "kilo", "organizationId"],
    ["indexing", "openai", "apiKey"],
    ["indexing", "ollama", "baseUrl"],
    ["indexing", "openai-compatible", "baseUrl"],
    ["indexing", "openai-compatible", "apiKey"],
    ["indexing", "gemini", "apiKey"],
    ["indexing", "mistral", "apiKey"],
    ["indexing", "vercel-ai-gateway", "apiKey"],
    ["indexing", "bedrock", "region"],
    ["indexing", "bedrock", "profile"],
    ["indexing", "openrouter", "apiKey"],
    ["indexing", "openrouter", "specificProvider"],
    ["indexing", "voyage", "apiKey"],
    ["indexing", "qdrant", "url"],
    ["indexing", "qdrant", "apiKey"],
    ["indexing", "lancedb", "directory"],
    ["indexing", "searchMinScore"],
    ["indexing", "searchMaxResults"],
    ["indexing", "embeddingBatchSize"],
    ["indexing", "scannerMaxBatchRetries"],
  ] as const

  const collectionPaths = ["provider", "mcp", "permission", "agent", "formatter", "lsp"] as const
  const blocked = new Set(["__proto__", "constructor", "prototype"])

  export async function project(input: { directory: string; worktree?: string }): Promise<Config.Info> {
    const found = await projectFiles(input)
    // kilocode_change - project config is untrusted; confine {file:} reads to the project root
    const root = input.worktree && input.worktree !== "/" ? input.worktree : input.directory
    const configs = await Promise.all(found.map((file) => load(file, { root, source: file })))
    return configs.reduce((result, cfg) => KilocodeConfig.mergeConfig(result, cfg), {} as Config.Info)
  }

  export async function projectTarget(input: { directory: string; worktree?: string }) {
    const found = await Filesystem.findUp(dirs.toReversed(), input.directory, input.worktree)
    const roots = await Filesystem.findUp([...files], input.directory, input.worktree)
    const candidates = [...found.flatMap((dir) => files.map((file) => path.join(dir, file))), ...roots]
    return candidates.find((file) => existsSync(file)) ?? path.join(input.directory, ".kilo", "kilo.jsonc")
  }

  export function globalTarget() {
    const candidates = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "config.json"].map((file) =>
      path.join(Global.Path.config, file),
    )
    return candidates.find((file) => existsSync(file)) ?? candidates[0]
  }

  export async function resolve(input: Input): Promise<Result> {
    // kilocode_change start - project agents untrusted, {file:} confined to the project root; global agents trusted
    const root = input.worktree && input.worktree !== "/" ? input.worktree : input.directory
    const local = await withAgents(await project(input), await projectDirs(input), false, root)
    const global = await withAgents(input.global, globalDirs(), true)
    // kilocode_change end
    const targets = {
      global: globalTarget(),
      project: await projectTarget(input),
      active: input.scope === "global" ? globalTarget() : await projectTarget(input),
    }
    return {
      scope: input.scope,
      effective: input.effective,
      global,
      project: local,
      sources: input.sources,
      targets,
      fields: Object.fromEntries(
        fieldPaths.map((parts) => [parts.join("."), field(input.scope, input.effective, global, local, [...parts])]),
      ),
      collections: Object.fromEntries(
        collectionPaths.map((key) => [key, collection(input.scope, input.effective, global, local, key)]),
      ),
    }
  }

  export function patch(input: Patch): Config.Info {
    const base = { ...(input.set ?? {}) }
    for (const parts of input.unset ?? []) set(base, parts, null)
    return base as Config.Info
  }

  async function projectFiles(input: { directory: string; worktree?: string }) {
    const roots = await Filesystem.findUp([...files], input.directory, input.worktree, { rootFirst: true })
    const found = await Filesystem.findUp([...dirs], input.directory, input.worktree)
    const nested = found.flatMap((dir) => files.map((file) => path.join(dir, file)))
    const checks = await Promise.all(
      [...roots, ...nested].map(async (file) => ({ file, exists: await Bun.file(file).exists() })),
    )
    return [...new Set(checks.filter((item) => item.exists).map((item) => item.file))]
  }

  async function projectDirs(input: { directory: string; worktree?: string }) {
    return Filesystem.findUp([...dirs], input.directory, input.worktree)
  }

  function globalDirs() {
    return [Global.Path.config, path.join(Global.Path.home, ".kilocode"), path.join(Global.Path.home, ".kilo")]
  }

  // kilocode_change start - root confines untrusted agent {file:} reads
  async function withAgents(input: Config.Info, dirs: string[], trusted: boolean, root?: string): Promise<Config.Info> {
    const [dir, ...rest] = dirs
    if (!dir) return input
    if (!existsSync(dir)) return withAgents(input, rest, trusted, root)
    const fileScope = trusted || !root ? undefined : { root, source: dir }
    const agent = await ConfigAgent.load(dir, undefined, trusted, fileScope)
    const mode = await ConfigAgent.loadMode(dir)
    const next = KilocodeConfig.mergeConfig(KilocodeConfig.mergeConfig(input, { agent }), { agent: mode })
    return withAgents(next, rest, trusted, root)
  }
  // kilocode_change end

  async function load(file: string, fileScope?: ConfigVariable.FileScope): Promise<Config.Info> {
    // kilocode_change start - a single unsafe/invalid project config file must not break the settings overlay;
    // untrusted {env:} and out-of-scope {file:} throw InvalidError here, so skip the offending file like the
    // main config loader does rather than failing the whole overlay.
    return await loadUnsafe(file, fileScope).catch((err) => {
      log.warn("skipping unreadable project config in overlay", { file, err })
      return {} as Config.Info
    })
  }

  async function loadUnsafe(file: string, fileScope?: ConfigVariable.FileScope): Promise<Config.Info> {
    // kilocode_change end
    const text = await Bun.file(file).text()
    // kilocode_change - overlay reads project config files: {env:} rejected, {file:} confined to fileScope.root
    const expanded = await ConfigVariable.substitute({ text, type: "path", path: file, trusted: false, fileScope })
    const parsed = ConfigParse.jsonc(expanded, file)
    if (!isRecord(parsed)) return {}
    return ConfigParse.schema(Config.Info, parsed, file) as Config.Info
  }

  function field(
    scope: Scope,
    effective: Config.Info,
    global: Config.Info,
    local: Config.Info,
    parts: string[],
  ): Resolved {
    const key = parts.join(".")
    const value = fieldValue(scope, effective, global, local, parts)
    const hasValue = hasFieldValue(scope, effective, global, local, parts)
    return resolved({
      key,
      path: parts,
      scope,
      value,
      global: get(global, parts),
      local: get(local, parts),
      hasValue,
      hasGlobal: has(global, parts),
      hasLocal: has(local, parts),
    })
  }

  function isIndexing(parts: string[]) {
    return parts[0] === "indexing"
  }

  function fieldValue(scope: Scope, effective: Config.Info, global: Config.Info, local: Config.Info, parts: string[]) {
    if (!isIndexing(parts)) return get(effective, parts)
    if (scope === "project" && has(local, parts)) return get(local, parts)
    if (has(global, parts)) return get(global, parts)
    if (scope === "global" && has(local, parts)) return undefined
    return get(effective, parts)
  }

  function hasFieldValue(
    scope: Scope,
    effective: Config.Info,
    global: Config.Info,
    local: Config.Info,
    parts: string[],
  ) {
    if (!isIndexing(parts)) return has(effective, parts)
    if (scope === "project" && has(local, parts)) return true
    if (has(global, parts)) return true
    return !has(local, parts) && has(effective, parts)
  }

  function collection(scope: Scope, effective: Config.Info, global: Config.Info, local: Config.Info, key: string) {
    const names = new Set([
      ...Object.keys(record(get(effective, [key]))),
      ...Object.keys(record(get(global, [key]))),
      ...Object.keys(record(get(local, [key]))),
    ])
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const parts = [key, name]
        return resolved({
          key: name,
          path: parts,
          scope,
          value: get(effective, parts),
          global: get(global, parts),
          local: get(local, parts),
          hasValue: has(effective, parts),
          hasGlobal: has(global, parts),
          hasLocal: has(local, parts),
        })
      })
  }

  function resolved(input: {
    key: string
    path: string[]
    scope: Scope
    value: unknown
    global: unknown
    local: unknown
    hasValue: boolean
    hasGlobal: boolean
    hasLocal: boolean
  }): Resolved {
    const source = origin(input)
    return {
      key: input.key,
      path: input.path,
      value: input.value,
      global: input.global,
      local: input.local,
      source,
      inherited: input.scope === "project" && source === "global",
      overridden: input.scope === "project" ? input.hasLocal : source === "global",
      editable: source !== "system" || input.scope === "project",
      reason: source === "system" ? "Resolved from runtime, cloud, environment, or managed config." : undefined,
    }
  }

  function origin(input: { scope: Scope; hasValue: boolean; hasGlobal: boolean; hasLocal: boolean }): Origin {
    if (input.scope === "project" && input.hasLocal) return "project"
    if (input.hasGlobal) return "global"
    if (input.hasValue) return "system"
    return "default"
  }

  function has(input: unknown, parts: string[]) {
    let cur = input
    for (const part of parts) {
      if (!isRecord(cur) || !(part in cur)) return false
      cur = cur[part]
    }
    return true
  }

  function get(input: unknown, parts: string[]): unknown {
    let cur = input
    for (const part of parts) {
      if (!isRecord(cur)) return undefined
      cur = cur[part]
    }
    return cur
  }

  function set(input: Record<string, unknown>, parts: string[], value: unknown) {
    const [head, ...tail] = parts
    if (!head || blocked.has(head)) return
    if (tail.length === 0) {
      input[head] = value
      return
    }
    const next = isRecord(input[head]) ? { ...input[head] } : {}
    input[head] = next
    set(next, tail, value)
  }

  function record(input: unknown) {
    if (isRecord(input)) return input
    return {}
  }
}
