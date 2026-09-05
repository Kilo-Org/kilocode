export * as ProjectConfig from "./project-config.js"

import { Config } from "@opencode-ai/core/config"
import { Bus } from "@opencode-ai/core/bus"
import { Credential } from "@opencode-ai/core/credential"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { WellKnown } from "@opencode-ai/core/wellknown"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { ConfigNormalize } from "@opencode-ai/core/config/normalize"
import { ConfigMarkdown } from "@opencode-ai/core/config/markdown"
import { ConfigVariable } from "@opencode-ai/core/config/variable"
import { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ConfigAgent } from "@opencode-ai/schema/config/agent"
import { AgentsDirectory, Document, Info, type Entry } from "@opencode-ai/schema/config"
import { Effect, Layer, Option, Schema } from "effect"
import { lstat, realpath, readdir } from "node:fs/promises"
import path from "node:path"
import { parse, type ParseError } from "jsonc-parser"

export interface Options {
  readonly enabled?: boolean
  readonly file?: string
  readonly content?: string
}

const files = ["kilo.json", "kilo.jsonc"]
const directories = [".kilo", ".kilocode"]
const agentDirectories = ["agent", "agents"] as const
const decodeOptions = { errors: "all", propertyOrder: "original" } as const
const decodeAgent = Schema.decodeUnknownOption(ConfigAgent.Info)
const decodeLegacyAgent = Schema.decodeUnknownOption(ConfigAgentV1.Info)
const decodeConfig = Schema.decodeUnknownOption(Info)
const agentKeys = new Set(["variant", ...Object.keys(ConfigAgent.Info.fields)])

/**
 * Extend the isolated config service, not the plugin loader. Project documents
 * are opt-in; never emit generic Directory entries, which also execute plugins.
 * File changes are picked up on location restart (the preview disables watchers).
 * Agent maps use the native schema, and markdown agents are decoded through the
 * same current/v1 compatibility schemas as the core config-agent plugin.
 * Legacy trust provenance and trusted skill shell expansion remain unsupported.
 */
export function configured(options: Options = {}) {
  const base = Config.configured({ global: false, project: false, file: options.file, content: options.content })
  if (!options.enabled) return base
  return makeLocationNode({
    service: Config.Service,
    deps: [Watcher.node, Bus.node, FSUtil.node, Global.node, Location.node, Credential.node, WellKnown.node],
    layer: Layer.effect(
      Config.Service,
      Effect.gen(function* () {
        const upstream = yield* Config.Service
        const location = yield* Location.Service
        const entries = yield* readProjectEntries(location.directory, location.project.directory).pipe(Effect.orDie)
        return Config.Service.of({
          entries: Effect.fnUntraced(function* () {
            return [...(yield* upstream.entries()), ...entries]
          }),
          changes: upstream.changes,
        })
      }),
    ).pipe(
      Layer.provide(Config.layer({ global: false, project: false, file: options.file, content: options.content })),
    ),
  })
}

/** Canonical boundary walk, lowest to highest priority, using native config entries. */
export function readProjectEntries(directory: string, project: string) {
  return Effect.gen(function* () {
    const boundary = yield* Effect.promise(() => realpath(project))
    const start = yield* Effect.promise(() => realpath(directory))
    if (!contains(boundary, start)) throw new Error("Project configuration directory is outside its project boundary")
    const ancestors = (current: string): string[] =>
      current === boundary ? [current] : [...ancestors(path.dirname(current)), current]
    const roots = ancestors(start)
    const entries: Entry[] = []
    const read = Effect.fnUntraced(function* (filename: string) {
      if (!(yield* Effect.promise(() => eligible(filename, boundary, "file")))) return
      const source = yield* Effect.promise(() => Bun.file(filename).text())
      const text = yield* ConfigVariable.substitute({ type: "path", path: filename, text: source })
      const errors: ParseError[] = []
      const raw: unknown = parse(text, errors, { allowTrailingComma: true })
      if (errors.length) throw new Error(`Invalid project JSONC configuration: ${filename}`)
      const normalized = ConfigNormalize.normalize(raw)
      if (normalized.type === "rejected") throw new Error(`Unsupported project configuration: ${filename}`)
      // Diagnostics carry paths, never configuration values or provider secrets.
      for (const diagnostic of normalized.diagnostics)
        console.error(`Project configuration: ${filename}: ${diagnostic.path.join(".")} (${diagnostic.kind})`)
      const info = Option.getOrUndefined(Schema.decodeUnknownOption(Info)(normalized.encoded))
      if (!info) throw new Error(`Invalid project configuration schema: ${filename}`)
      if (info.plugins?.length) console.error(`Project plugins are disabled: ${filename}`)
      const skills = yield* Effect.forEach(info.skills ?? [], (source) => {
        // Remote discovery has its own cache boundary and remains untrusted.
        if (URL.canParse(source) && ["http:", "https:"].includes(new URL(source).protocol))
          return Effect.succeed(source)
        return Effect.promise(() => eligible(path.resolve(start, source), boundary, "directory")).pipe(
          Effect.map((allowed) => {
            if (allowed) return source
            console.error(`Project skill source outside the boundary or unavailable: ${filename}`)
            return undefined
          }),
        )
      })
      entries.push(
        new Document({
          type: "document",
          path: AbsolutePath.make(filename),
          info: new Info({
            ...info,
            plugins: undefined,
            ...(info.skills === undefined ? {} : { skills: skills.filter((source) => source !== undefined) }),
          }),
        }),
      )
    })
    for (const root of roots) for (const name of files) yield* read(path.join(root, name))
    for (const root of roots) {
      for (const name of directories) {
        const source = path.join(root, name)
        if (!(yield* Effect.promise(() => eligible(source, boundary, "directory")))) continue
        for (const file of files) yield* read(path.join(source, file))
        // AgentsDirectory is a native skills-only source; it does not scan agent or plugin code.
        if (yield* Effect.promise(() => eligible(path.join(source, "skills"), boundary, "directory")))
          entries.push(new AgentsDirectory({ type: "agents", path: AbsolutePath.make(source) }))
        for (const name of agentDirectories) {
          const agentRoot = path.join(source, name)
          if (!(yield* Effect.promise(() => eligible(agentRoot, boundary, "directory")))) continue
          const markdown = yield* Effect.promise(() => markdownFiles(agentRoot)).pipe(
            Effect.orElseSucceed(() => [] as string[]),
          )
          for (const filename of markdown) {
            const entry = yield* readMarkdownAgent(filename, source, boundary)
            if (entry) entries.push(entry)
          }
        }
      }
    }
    return entries
  })
}

function readMarkdownAgent(filename: string, directory: string, boundary: string) {
  return Effect.gen(function* () {
    if (!(yield* Effect.promise(() => eligible(filename, boundary, "file")))) return
    const content = yield* Effect.promise(() => Bun.file(filename).text()).pipe(Effect.orElseSucceed(() => undefined))
    if (content === undefined) return
    const markdown = ConfigMarkdown.parseOption(content)
    if (!markdown) return
    const name = path
      .relative(directory, filename)
      .replaceAll("\\", "/")
      .replace(/^(agent|agents)\//, "")
      .replace(/\.md$/, "")
    if (!name) return
    const body = markdown.content.trim()
    const legacy = Object.keys(markdown.data).some((key) => !agentKeys.has(key))
    const agent = legacy
      ? Option.getOrUndefined(
          Option.map(
            decodeLegacyAgent({ name, ...markdown.data, prompt: body }, decodeOptions),
            ConfigMigrateV1.migrateAgent,
          ),
        )
      : Option.getOrUndefined(decodeAgent({ ...markdown.data, system: body }))
    if (!agent) return
    const info = Option.getOrUndefined(decodeConfig({ agents: { [name]: agent } }))
    if (!info) return
    return new Document({ type: "document", path: AbsolutePath.make(filename), info })
  })
}

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isSymbolicLink()) return []
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) return markdownFiles(filename)
      if (entry.isFile() && path.extname(entry.name) === ".md") return [filename]
      return []
    }),
  )
  return files.flat().toSorted()
}

async function eligible(filename: string, boundary: string, kind: "file" | "directory") {
  const stat = await lstat(filename).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined
    throw error
  })
  if (!stat || stat.isSymbolicLink()) return false
  if (kind === "file" && !stat.isFile()) throw new Error(`Project configuration is not a regular file: ${filename}`)
  if (kind === "directory" && !stat.isDirectory()) return false
  if (kind === "file" && stat.size > 1024 * 1024) throw new Error(`Project configuration exceeds 1 MiB: ${filename}`)
  return contains(boundary, await realpath(filename))
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}
