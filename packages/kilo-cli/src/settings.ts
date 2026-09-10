import { NodeFileSystem } from "@effect/platform-node"
import { ConfigNormalize } from "@opencode-ai/core/config/normalize"
import { ConfigVariable } from "@opencode-ai/core/config/variable"
import { define, type Context, type Plugin } from "@opencode-ai/plugin/effect/plugin"
import type { RpcHandlers } from "@opencode-ai/plugin/effect/rpc"
import { Info } from "@opencode-ai/schema/config"
import { ConfigModel } from "@opencode-ai/schema/config/model"
import { ConfigWarming } from "@opencode-ai/schema/config/warming"
import { ConfigWebSearch } from "@opencode-ai/schema/config/websearch"
import type { Location } from "@opencode-ai/schema/location"
import { NonNegativeInt, PositiveInt } from "@opencode-ai/schema/schema"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect, Layer, Option, Schema } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { createHash, randomUUID } from "node:crypto"
import { chmod, lstat, mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { preflight, type Layout } from "./paths"
import { ProjectConfig } from "./project-config"
import { serializeConfigWrite } from "./config-write"
import {
  SETTINGS_FIELD_KEYS,
  SETTINGS_UNSUPPORTED_NOTE,
  SettingsRpc,
  type SettingsChange,
  type SettingsCollection,
  type SettingsCollectionChange,
  type SettingsCollectionSnapshot,
  type SettingsDiagnostic,
  type SettingsExpected,
  type SettingsFieldKey,
  type SettingsFieldState,
  type SettingsScope,
  type SettingsScopeState,
  type SettingsSnapshot,
} from "./settings-rpc"

export { SETTINGS_FIELD_KEYS, SETTINGS_SCOPES, SETTINGS_UNSUPPORTED_NOTE, SettingsRpc } from "./settings-rpc"
export type {
  SettingsChange,
  SettingsFieldKey,
  SettingsFieldKind,
  SettingsFieldState,
  SettingsScope,
  SettingsScopeState,
  SettingsSnapshot,
} from "./settings-rpc"

export const SETTINGS_PLUGIN_ID = "kilo.settings"

/**
 * Project documents are opt-in in this host (`ProjectConfig.configured({ enabled })`),
 * so a project write is only offered when the host enabled them. `boundary` is
 * the project directory that confines every project document.
 */
export interface SettingsProjectOptions {
  readonly enabled: boolean
  readonly directory: string
  readonly boundary: string
}

export interface SettingsStoreOptions {
  /** Isolated profile storage. The profile target is `layout.config`. */
  readonly layout: Layout
  readonly project: SettingsProjectOptions
  /** True only when the host watches config files; the preview does not. */
  readonly watched?: boolean
}

export interface SettingsStore {
  read(): Promise<SettingsSnapshot>
  set(input: {
    readonly scope: SettingsScope
    readonly key: SettingsFieldKey
    readonly value: unknown
    readonly expected?: SettingsExpected
  }): Promise<SettingsChange>
  reset(input: {
    readonly scope: SettingsScope
    readonly key: SettingsFieldKey
    readonly expected?: SettingsExpected
  }): Promise<SettingsChange>
  collections: {
    get(input: {
      readonly collection: SettingsCollection
      readonly scope: SettingsScope
    }): Promise<SettingsCollectionSnapshot>
    set(input: {
      readonly scope: SettingsScope
      readonly collection: SettingsCollection
      readonly key?: string
      readonly value: unknown
      readonly expected?: SettingsExpected
    }): Promise<SettingsCollectionChange>
    unset(input: {
      readonly scope: SettingsScope
      readonly collection: SettingsCollection
      readonly key?: string
      readonly expected?: SettingsExpected
    }): Promise<SettingsCollectionChange>
  }
  warnings(): Promise<ReadonlyArray<SettingsDiagnostic>>
}

interface FieldDefinition {
  readonly key: SettingsFieldKey
  readonly path: readonly string[]
  readonly title: string
  readonly description: string
  readonly kind: SettingsFieldState["kind"]
  readonly minimum?: number
  /**
   * Kilo-only key: the native `Info` decode drops it, so values are read from
   * the raw documents instead of the re-encoded ones. Writes still go through
   * the native verify pipeline, which tolerates unknown keys.
   */
  readonly kiloOnly?: boolean
  /** Decoder for the native schema the written value must satisfy. */
  readonly decode: (value: unknown) => Option.Option<unknown>
  readonly options?: SettingsFieldState["options"]
}

/** Ordered configuration documents a scope contributes, from lowest to highest priority. */
interface ScopeProjection {
  readonly state: SettingsScopeState
  readonly documents: readonly Record<string, unknown>[]
  /**
   * Same documents as `documents`, but parsed raw: Kilo-only keys that the
   * native `Info` decode would drop stay visible here. Empty unless the scope's
   * documents were actually loaded.
   */
  readonly raw: readonly Record<string, unknown>[]
  /** Source paths of the `raw` documents, for per-document diagnostics. */
  readonly rawSources: readonly string[]
}

// Every field below is a native v2 Config.Info field with a verified consumer.
const definitions: readonly FieldDefinition[] = [
  {
    key: "model",
    path: ["model"],
    title: "Default model",
    description:
      'Model used when no session or agent model is selected, written as "provider/model" or "provider/model#variant"',
    kind: "string",
    decode: Schema.decodeUnknownOption(ConfigModel.Selection),
  },
  {
    key: "default_agent",
    path: ["default_agent"],
    title: "Default agent",
    description: "Primary agent used when no session agent is selected",
    kind: "string",
    decode: Schema.decodeUnknownOption(Schema.String.check(Schema.isMinLength(1))),
  },
  {
    key: "shell",
    path: ["shell"],
    title: "Shell",
    description: "Shell used for terminal and shell tool execution",
    kind: "string",
    decode: Schema.decodeUnknownOption(Schema.String.check(Schema.isMinLength(1))),
  },
  {
    key: "snapshots",
    path: ["snapshots"],
    title: "Snapshots",
    description: "Enable the snapshots that back undo and revert",
    kind: "boolean",
    decode: Schema.decodeUnknownOption(Schema.Boolean),
  },
  {
    key: "websearch",
    path: ["websearch"],
    title: "Web search",
    description: "Web search provider selection",
    kind: "choice",
    decode: Schema.decodeUnknownOption(ConfigWebSearch.Selection),
    options: [
      { title: "Disabled", value: false },
      { title: "Random provider", value: { provider: "random" } },
    ],
  },
  {
    key: "warming",
    path: ["warming"],
    title: "Session warming",
    description:
      "Keep recently active sessions warm with transient model requests. A stored object form is preserved but only on/off is editable here",
    kind: "boolean",
    decode: Schema.decodeUnknownOption(ConfigWarming.Warming),
  },
  {
    key: "compaction.auto",
    path: ["compaction", "auto"],
    title: "Automatic compaction",
    description: "Compact session history automatically when it approaches the model context limit",
    kind: "boolean",
    decode: Schema.decodeUnknownOption(Schema.Boolean),
  },
  {
    key: "compaction.buffer",
    path: ["compaction", "buffer"],
    title: "Compaction token buffer",
    description: "Token headroom used by native v2 compaction, not a context percentage",
    kind: "integer",
    minimum: 0,
    decode: Schema.decodeUnknownOption(NonNegativeInt),
  },
  {
    key: "compaction.keep.tokens",
    path: ["compaction", "keep", "tokens"],
    title: "Compaction retained tokens",
    description: "Recent-history token budget retained by native v2 compaction",
    kind: "integer",
    minimum: 0,
    decode: Schema.decodeUnknownOption(NonNegativeInt),
  },
  {
    key: "tool_output.max_lines",
    path: ["tool_output", "max_lines"],
    title: "Tool output line limit",
    description: "Lines kept before tool output is truncated",
    kind: "integer",
    decode: Schema.decodeUnknownOption(PositiveInt),
  },
  {
    key: "tool_output.max_bytes",
    path: ["tool_output", "max_bytes"],
    title: "Tool output byte limit",
    description: "Bytes kept before tool output is truncated",
    kind: "integer",
    decode: Schema.decodeUnknownOption(PositiveInt),
  },
  {
    key: "media.image.auto_resize",
    path: ["media", "image", "auto_resize"],
    title: "Auto-resize images",
    description: "Resize images that exceed the width, height, or byte limits instead of refusing them",
    kind: "boolean",
    decode: Schema.decodeUnknownOption(Schema.Boolean),
  },
  {
    key: "media.image.max_width",
    path: ["media", "image", "max_width"],
    title: "Image width limit",
    description: "Maximum image width in pixels before images are resized or refused",
    kind: "integer",
    decode: Schema.decodeUnknownOption(PositiveInt),
  },
  {
    key: "media.image.max_height",
    path: ["media", "image", "max_height"],
    title: "Image height limit",
    description: "Maximum image height in pixels before images are resized or refused",
    kind: "integer",
    decode: Schema.decodeUnknownOption(PositiveInt),
  },
  {
    key: "media.image.max_base64_bytes",
    path: ["media", "image", "max_base64_bytes"],
    title: "Image byte limit",
    description: "Maximum inline image size in bytes before images are resized or refused",
    kind: "integer",
    decode: Schema.decodeUnknownOption(PositiveInt),
  },
  {
    key: "experimental.subagent_depth",
    path: ["experimental", "subagent_depth"],
    title: "Subagent nesting depth (experimental)",
    description: "Maximum subagent nesting depth. Defaults to 1",
    kind: "integer",
    minimum: 0,
    decode: Schema.decodeUnknownOption(NonNegativeInt),
  },
  {
    key: "experimental.portable_shell_scanner",
    path: ["experimental", "portable_shell_scanner"],
    title: "Portable shell scanner (experimental)",
    description: "Use the experimental portable shell permission scanner for shell commands",
    kind: "boolean",
    decode: Schema.decodeUnknownOption(Schema.Boolean),
  },
  {
    key: "hide_prompt_training_models",
    path: ["hide_prompt_training_models"],
    title: "Hide prompt-training models",
    description:
      "Hide Kilo Gateway models whose metadata says they may train on your prompts, and send a data-collection deny request with every Kilo Gateway request. A request to the Gateway, not a guarantee that providers honor it",
    kind: "boolean",
    kiloOnly: true,
    decode: Schema.decodeUnknownOption(Schema.Boolean),
  },
]

// Mirrors the host config parser: jsonc with trailing commas, lenient decoding.
const decodeOptions = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const
const decodeInfo = Schema.decodeUnknownOption(Info, decodeOptions)
const encodeInfo = Schema.encodeUnknownOption(Info)
const formattingOptions = { insertSpaces: true, tabSize: 2 } as const
const filesystem = FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer))
const maxDocumentBytes = 1024 * 1024
// First-write location when a project has no eligible document yet, matching the
// directory Kilo documents recommend.
const projectFallback = [".kilo", "kilo.jsonc"] as const

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  return {
    read,
    set: (input) =>
      serializeConfigWrite(options.layout.config, () =>
        apply(input.scope, input.key, { set: input.value }, input.expected),
      ),
    reset: (input) =>
      serializeConfigWrite(options.layout.config, () => apply(input.scope, input.key, { reset: true }, input.expected)),
    collections: {
      get: (input) => collectionGet(input.collection, input.scope),
      set: (input) =>
        serializeConfigWrite(options.layout.config, () =>
          applyCollection(input.scope, input.collection, input.key, { set: input.value }, input.expected),
        ),
      unset: (input) =>
        serializeConfigWrite(options.layout.config, () =>
          applyCollection(input.scope, input.collection, input.key, { reset: true }, input.expected),
        ),
    },
    warnings: collectDiagnostics,
  }

  async function read(): Promise<SettingsSnapshot> {
    const scopes = [await profileProjection(), await projectProjection()]
    return {
      scopes: await Promise.all(
        scopes.map(async (projection) => ({
          ...projection.state,
          ...(projection.state.writable
            ? {
                expected: {
                  path: projection.state.path,
                  revision: projection.state.exists ? revision(await text(projection.state.path)) : null,
                },
              }
            : {}),
        })),
      ),
      fields: definitions.map((field) => state(field, scopes)),
      restartRequired: options.watched !== true,
      note: SETTINGS_UNSUPPORTED_NOTE,
    }
  }

  async function apply(
    scope: SettingsScope,
    key: SettingsFieldKey,
    value: { readonly set: unknown } | { readonly reset: true },
    expected?: SettingsExpected,
  ): Promise<SettingsChange> {
    const field = definitions.find((item) => item.key === key)
    if (!field) throw new Error(`Unknown Kilo setting: ${key}`)
    const target = (scope === "profile" ? await profileProjection() : await projectProjection()).state
    if (!target.writable) throw new Error(target.reason ?? `The ${scope} configuration target is not writable`)
    if ("set" in value && Option.isNone(field.decode(value.set)))
      throw new Error(`The supplied value is not valid for ${key}`)
    const before = target.exists ? await text(target.path) : ""
    if (expected && (expected.path !== target.path || expected.revision !== (target.exists ? revision(before) : null)))
      throw new Error("Configuration changed since this dialog was opened. Reopen Kilo settings and try again.")
    const parsed = before === "" ? {} : json(before, target.path)
    for (const [index, segment] of field.path.slice(0, -1).entries()) {
      const parent = at(parsed, field.path.slice(0, index + 1))
      if (parent !== undefined && !isObject(parent))
        throw new Error(`Existing "${segment}" value in ${target.path} is not an object`)
    }
    if ("reset" in value && at(parsed, field.path) === undefined)
      return { scope, key, path: target.path, changed: false, snapshot: await read() }
    const source = before === "" ? "{}" : before
    const updated = applyEdits(
      source,
      modify(source, [...field.path], "set" in value ? value.set : undefined, { formattingOptions }),
    )
    if (updated !== source) verify(updated, parsed, target.path)
    if (updated !== before) await write(target, updated)
    return { scope, key, path: target.path, changed: updated !== before, snapshot: await read() }
  }

  /**
   * The profile document is the host's explicit config source. A preflight
   * failure stops every read of that path instead of reporting its contents.
   */
  async function profileProjection(): Promise<ScopeProjection> {
    const file = options.layout.config
    const failure = guard()
    if (failure)
      return {
        state: { scope: "profile", path: file, exists: false, writable: false, reason: failure },
        documents: [],
        raw: [],
        rawSources: [],
      }
    if (!(await isFile(file)))
      return {
        state: { scope: "profile", path: file, exists: false, writable: true },
        documents: [],
        raw: [],
        rawSources: [],
      }
    const raw = await rawDocument(file)
    const rawDocuments = raw ? [raw] : []
    const document = await load(file).catch(() => undefined)
    if (!document)
      return {
        state: {
          scope: "profile",
          path: file,
          exists: true,
          writable: true,
          // Blanket honesty: native configuration from this document is ignored by the host,
          // while separately parsed Kilo-only values may still apply (and are reported below).
          reason:
            "The profile document is not valid native configuration and the host ignores it; separately parsed Kilo-only values may still apply",
        },
        documents: [],
        raw: rawDocuments,
        rawSources: [file],
      }
    return {
      state: { scope: "profile", path: file, exists: true, writable: true },
      documents: [document],
      raw: rawDocuments,
      rawSources: [file],
    }
  }

  /**
   * Project values come from every document `ProjectConfig.readProjectEntries`
   * loads, so an ancestor or lower-priority document still contributes keys. The
   * write target is the highest-priority document the host actually loaded.
   */
  async function projectProjection(): Promise<ScopeProjection> {
    const boundary = await realpath(options.project.boundary).catch(() => undefined)
    const directory = await realpath(options.project.directory).catch(() => undefined)
    const fallback = boundary && directory ? path.join(directory, ...projectFallback) : undefined
    if (!boundary || !directory || !fallback || !contains(boundary, directory))
      return {
        state: {
          scope: "project",
          path: path.join(options.project.directory, ...projectFallback),
          exists: false,
          writable: false,
          reason: "The project directory is outside its project boundary",
        },
        documents: [],
        raw: [],
        rawSources: [],
      }
    if (!options.project.enabled)
      return {
        state: {
          scope: "project",
          path: fallback,
          exists: await isFile(fallback),
          writable: false,
          reason: "Project configuration is disabled; start the host with --project-config to manage this scope",
        },
        documents: [],
        raw: [],
        rawSources: [],
      }
    const entries = await Effect.runPromise(
      ProjectConfig.readProjectEntries(directory, boundary).pipe(Effect.provide(filesystem)),
    ).catch(() => undefined)
    if (!entries)
      return {
        state: {
          scope: "project",
          path: fallback,
          exists: await isFile(fallback),
          writable: false,
          reason: "Project configuration could not be read",
        },
        documents: [],
        raw: [],
        rawSources: [],
      }
    const loaded = entries.flatMap((entry) =>
      entry.type === "document" && entry.path !== undefined ? [{ path: entry.path, info: entry.info }] : [],
    )
    const documents = loaded.flatMap((entry) => {
      const encoded = encodeInfo(entry.info)
      return Option.isSome(encoded) && isObject(encoded.value) ? [encoded.value] : []
    })
    // Every loaded path, not only the write target: an ancestor document can
    // still contribute a Kilo-only key, which the native decode drops.
    const raw = (await Promise.all(loaded.map((entry) => rawDocument(entry.path)))).flatMap((parsed) =>
      parsed ? [parsed] : [],
    )
    const target = loaded.at(-1)?.path ?? fallback
    const eligible = await eligibleTarget(target, boundary)
    if (eligible)
      return {
        state: { scope: "project", path: target, exists: true, writable: false, reason: eligible },
        documents,
        raw,
        rawSources: loaded.map((entry) => entry.path),
      }
    return {
      state: { scope: "project", path: target, exists: await isFile(target), writable: true },
      documents,
      raw,
      rawSources: loaded.map((entry) => entry.path),
    }
  }

  /** Declared collection leaves over the native `Config.Info` field names. */
  function collectionDef(collection: SettingsCollection): {
    readonly path: readonly string[]
    readonly kind: "record" | "value"
  } {
    switch (collection) {
      case "providers":
        return { path: ["providers"], kind: "record" }
      case "agents":
        return { path: ["agents"], kind: "record" }
      case "permissions":
        return { path: ["permissions"], kind: "value" }
      case "policies":
        return { path: ["experimental", "policies"], kind: "value" }
    }
  }

  async function collectionDocuments(scope: SettingsScope) {
    const projections = [await profileProjection(), await projectProjection()]
    const ordered = [
      ...projections[0].documents.map((document) => ({ document, source: "profile" as const })),
      ...projections[1].documents.map((document) => ({ document, source: "project" as const })),
    ]
    return { ordered, scoped: scope === "profile" ? projections[0] : projections[1] }
  }

  async function collectionGet(
    collection: SettingsCollection,
    scope: SettingsScope,
  ): Promise<SettingsCollectionSnapshot> {
    const def = collectionDef(collection)
    const { ordered, scoped } = await collectionDocuments(scope)
    const entries: Record<string, unknown> = {}
    const provenance: Record<
      string,
      { source: "profile" | "project"; inherited: boolean; overridden: boolean; editable: boolean; reason?: string }
    > = {}
    for (const { document, source } of ordered) {
      const value = at(document, def.path)
      if (value === undefined) continue
      const provenanceFor = (key: string, overridden: boolean) => ({
        source,
        inherited: source === "profile",
        overridden,
        editable: scoped.state.writable,
        ...(scoped.state.writable ? {} : { reason: scoped.state.reason }),
      })
      if (def.kind === "record") {
        if (!isObject(value)) continue
        for (const [key, entry] of Object.entries(value)) {
          const previous = provenance[key] !== undefined
          entries[key] = entry
          provenance[key] = provenanceFor(key, previous)
        }
        continue
      }
      if (!Array.isArray(value)) continue
      const merged = Array.isArray(entries[""]) ? (entries[""] as ReadonlyArray<unknown>) : []
      entries[""] = [...merged, ...value]
      provenance[""] = provenanceFor("", source === "project")
    }
    const diagnostics: Array<SettingsDiagnostic> = []
    for (const source of scoped.rawSources) {
      const normalized = await normalizeDocument(source)
      for (const diagnostic of normalized.diagnostics) {
        if (diagnostic.path[0] !== def.path[0]) continue
        diagnostics.push({
          source,
          kind: diagnostic.kind,
          path: diagnostic.path.join("."),
          message: diagnostic.message,
        })
      }
    }
    return { scopes: (await read()).scopes, entries, provenance, diagnostics }
  }

  async function applyCollection(
    scope: SettingsScope,
    collection: SettingsCollection,
    key: string | undefined,
    value: { readonly set: unknown } | { readonly reset: true },
    expected?: SettingsExpected,
  ): Promise<SettingsCollectionChange> {
    const def = collectionDef(collection)
    if (def.kind === "record" && (key === undefined || key === ""))
      throw new Error(`A ${collection} entry key is required`)
    if (def.kind === "value" && key !== undefined)
      throw new Error(`${collection} is a whole-value collection and takes no entry key`)
    if ("set" in value && def.kind === "value" && !Array.isArray(value.set))
      throw new Error(`The supplied value is not a valid ${collection} list`)
    const target = (scope === "profile" ? await profileProjection() : await projectProjection()).state
    if (!target.writable) throw new Error(target.reason ?? `The ${scope} configuration target is not writable`)
    const before = target.exists ? await text(target.path) : ""
    if (expected && (expected.path !== target.path || expected.revision !== (target.exists ? revision(before) : null)))
      throw new Error("Configuration changed since this dialog was opened. Reopen Kilo settings and try again.")
    const parsed = before === "" ? {} : json(before, target.path)
    const leaf: string[] = def.kind === "record" ? [...def.path, key as string] : [...def.path]
    const existing = at(parsed, leaf)
    if ("reset" in value && existing === undefined)
      return { scope, collection, key: key ?? "", path: target.path, changed: false, snapshot: await read() }
    for (const parent of leaf.slice(0, -1)) {
      const node = at(parsed, [parent])
      if (node !== undefined && !isObject(node))
        throw new Error(`Existing "${parent}" value in ${target.path} is not an object`)
    }
    const source = before === "" ? "{}" : before
    const updated = applyEdits(
      source,
      modify(source, leaf, "set" in value ? value.set : undefined, { formattingOptions }),
    )
    if (updated !== source) {
      verify(updated, parsed, target.path)
      // An invalid collection entry refuses the write with its diagnostic path
      // instead of relying on the host decode to silently drop it. Pre-existing
      // diagnostics elsewhere in the document do not block the write.
      const normalized = ConfigNormalize.normalize(json(updated, target.path))
      const own = normalized.diagnostics.filter((diagnostic) => diagnostic.path[0] === def.path[0])
      if (own.length > 0) {
        const [first] = own
        throw new Error(`The supplied ${collection} entry is not valid: ${first.path.join(".")} (${first.kind})`)
      }
    }
    if (updated !== before) await write(target, updated)
    return { scope, collection, key: key ?? "", path: target.path, changed: updated !== before, snapshot: await read() }
  }

  async function collectDiagnostics(): Promise<ReadonlyArray<SettingsDiagnostic>> {
    const out: Array<SettingsDiagnostic> = []
    for (const scope of ["profile", "project"] as const) {
      const projection = scope === "profile" ? await profileProjection() : await projectProjection()
      for (const source of projection.rawSources) {
        const normalized = await normalizeDocument(source)
        for (const diagnostic of normalized.diagnostics) {
          out.push({ source, kind: diagnostic.kind, path: diagnostic.path.join("."), message: diagnostic.message })
        }
      }
    }
    return out
  }

  function guard() {
    try {
      preflight(options.layout)
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : "Profile storage failed preflight"
    }
  }

  async function write(target: SettingsScopeState, updated: string) {
    if (target.scope === "profile") guardOrThrow()
    await mkdir(path.dirname(target.path), { recursive: true, mode: 0o700 })
    // Preserve an existing mode; create new documents owner-only rather than
    // depending on the process umask.
    const mode = target.exists ? (await stat(target.path)).mode & 0o777 : 0o600
    const temporary = `${target.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, updated, { encoding: "utf8", flag: "wx", mode: 0o600 })
      await chmod(temporary, mode)
      if (target.scope === "profile") guardOrThrow()
      await rename(temporary, target.path)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  function guardOrThrow() {
    const failure = guard()
    if (failure) throw new Error(failure)
  }
}

function state(field: FieldDefinition, scopes: readonly ScopeProjection[]): SettingsFieldState {
  let invalid = false
  const values = Object.fromEntries(
    scopes.flatMap((scope) => {
      // Kilo-only keys survive only in the raw documents; native fields report
      // the canonical values the host resolves. Higher-priority documents win
      // inside a scope, matching Config.latest.
      const documents = field.kiloOnly ? scope.raw : scope.documents
      const value = documents.reduce<unknown>((result, document) => {
        const candidate = at(document, field.path)
        // A raw Kilo-only null is a stored value, not an absent one: it fails
        // decode below and is reported invalid. Undefined alone means absent.
        if (field.kiloOnly) return candidate === undefined ? result : candidate
        return candidate ?? result
      }, undefined)
      if (value === undefined) return []
      // A Kilo-only key is read raw, so a stored value can have any JSON type:
      // the snapshot explains the invalid state instead of carrying the value.
      if (field.kiloOnly && Option.isNone(field.decode(value))) {
        invalid = true
        return []
      }
      return [[scope.state.scope, value] as const]
    }),
  )
  return {
    key: field.key,
    title: field.title,
    description: field.description,
    kind: field.kind,
    ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
    ...(field.options ? { options: field.options } : {}),
    ...(invalid ? { invalid: `The stored ${field.key} value is not a boolean and is ignored` } : {}),
    values,
    source: values.project !== undefined ? "project" : values.profile !== undefined ? "profile" : "unset",
  }
}

function revision(source: string) {
  return createHash("sha256").update(source).digest("hex")
}

/**
 * Reject a document the edit would newly break, without rejecting one that was
 * already outside the strict schema before the edit.
 */
function verify(updated: string, before: Record<string, unknown>, filepath: string) {
  const next = json(updated, filepath)
  if (Option.isNone(decodeInfo(before))) return
  // Schema failures can echo decoded input, so nothing from the error surfaces.
  if (Option.isNone(decodeInfo(next))) throw new Error(`The resulting configuration is not valid: ${filepath}`)
}

/** Same pipeline the host applies to a config file: substitute, parse, normalize, decode. */
async function load(filepath: string) {
  const substituted = await Effect.runPromise(
    ConfigVariable.substitute({ type: "path", path: filepath, text: await text(filepath) }).pipe(
      Effect.provide(filesystem),
    ),
  )
  const normalized = ConfigNormalize.normalize(json(substituted, filepath))
  if (normalized.type === "rejected") return undefined
  const info = decodeInfo(normalized.encoded)
  if (Option.isNone(info)) return undefined
  const encoded = encodeInfo(info.value)
  return Option.isSome(encoded) && isObject(encoded.value) ? encoded.value : undefined
}

/**
 * The host config pipeline's normalize step, keeping the per-document
 * diagnostics that the write verifier and the warnings surface both need.
 */
async function normalizeDocument(filepath: string) {
  try {
    const substituted = await Effect.runPromise(
      ConfigVariable.substitute({ type: "path", path: filepath, text: await text(filepath) }).pipe(
        Effect.provide(filesystem),
      ),
    )
    return ConfigNormalize.normalize(json(substituted, filepath))
  } catch {
    return { type: "rejected", diagnostics: [] } as const
  }
}

/**
 * Raw JSONC parse without the host substitution or Info decode, for Kilo-only
 * keys. A document that does not parse contributes nothing rather than failing
 * the read.
 */
async function rawDocument(filepath: string) {
  try {
    return json(await text(filepath), filepath)
  } catch {
    return undefined
  }
}

async function text(filepath: string) {
  const file = Bun.file(filepath)
  if (file.size > maxDocumentBytes) throw new Error(`Configuration file exceeds 1 MiB: ${filepath}`)
  return file.text().catch(() => {
    throw new Error(`Failed to read configuration: ${filepath}`)
  })
}

function json(source: string, filepath: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const parsed: unknown = parse(source, errors, { allowTrailingComma: true })
  if (errors.length || !isObject(parsed)) throw new Error(`Configuration is not a JSON or JSONC object: ${filepath}`)
  return parsed
}

function at(root: Record<string, unknown>, keys: readonly string[]) {
  let node: unknown = root
  for (const key of keys) {
    if (!isObject(node)) return undefined
    node = node[key]
    if (node === undefined) return undefined
  }
  return node
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

/** Returns a refusal reason, or undefined when the path is safe to create or replace. */
async function eligibleTarget(filepath: string, boundary: string) {
  const info = await lstat(filepath).catch(() => undefined)
  if (info) {
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1)
      return "The project configuration target is a symlink or an irregular file"
    if (info.size > maxDocumentBytes) return "The project configuration target exceeds 1 MiB"
  }
  const directory = await lstat(path.dirname(filepath)).catch(() => undefined)
  if (directory && (directory.isSymbolicLink() || !directory.isDirectory()))
    return "The project configuration directory is a symlink or not a directory"
  const resolved = await realpath(info ? filepath : path.dirname(filepath)).catch(() => undefined)
  if (resolved !== undefined && !contains(boundary, resolved))
    return "The project configuration target is outside its project boundary"
  return undefined
}

async function isFile(filepath: string) {
  const info = await lstat(filepath).catch(() => undefined)
  return info?.isFile() === true && !info.isSymbolicLink()
}

export interface SettingsPluginOptions {
  /**
   * Host-provided config reload (the native Config.reload seam). Absent means
   * refresh is unavailable. The host provides its location-scoped services
   * inside the callback, so the handler runs it with no further requirements.
   */
  readonly refresh?: (location: Location.Info) => Effect.Effect<void, unknown, unknown>
  readonly layout: Layout
  /** Mirrors the host's --project-config opt-in. */
  readonly project?: boolean
  readonly watched?: boolean
}

/** Registerable handlers for the public RPC definition. Failures stay in the declared RPC error channel. */
export function createSettingsRpcHandlers(
  options: SettingsPluginOptions,
  location: Location.Info,
): RpcHandlers<typeof SettingsRpc.Definition> {
  const store = createSettingsStore({
    layout: options.layout,
    project: {
      enabled: options.project === true,
      directory: location.directory,
      boundary: location.project.directory,
    },
    ...(options.watched === undefined ? {} : { watched: options.watched }),
  })
  return {
    read: (_input, call) =>
      Effect.tryPromise({
        try: () => store.read(),
        catch: (error) => call.error("kilocode.settings", message(error)),
      }),
    set: (input, call) =>
      Effect.tryPromise({
        try: () => store.set(input),
        catch: (error) => call.error("kilocode.settings", message(error)),
      }),
    reset: (input, call) =>
      Effect.tryPromise({
        try: () => store.reset(input),
        catch: (error) => call.error("kilocode.settings", message(error)),
      }),
    collectionGet: (input, call) =>
      Effect.tryPromise({
        try: () => store.collections.get(input),
        catch: (error) => call.error("kilocode.settings", message(error)),
      }),
    collectionSet: (input, call) =>
      Effect.tryPromise({
        try: () => store.collections.set(input),
        catch: (error) => call.error("kilocode.settings", message(error)),
      }),
    collectionUnset: (input, call) =>
      Effect.tryPromise({
        try: () => store.collections.unset(input),
        catch: (error) => call.error("kilocode.settings", message(error)),
      }),
    warnings: (_input, call) =>
      Effect.tryPromise({
        try: () => store.warnings(),
        catch: (error) => call.error("kilocode.settings", message(error)),
      }),
    refresh: (_input, call) =>
      Effect.tryPromise({
        try: () => {
          if (!options.refresh) throw new Error("Configuration refresh is not available for this location")
          // The host callback provides its own location services; the unknown
          // requirement type is satisfied by that provide at runtime.
          const run = options.refresh(location) as Effect.Effect<void, unknown>
          return Effect.runPromise(run).then(() => true)
        },
        catch: (error) => call.error("kilocode.settings", message(error)),
      }),
  }
}

/** Location-scoped settings plugin. The host supplies the profile layout explicitly. */
export function createSettingsPlugin(options: SettingsPluginOptions): Plugin {
  return define({
    id: SETTINGS_PLUGIN_ID,
    effect: (ctx) =>
      Effect.fn("KiloSettingsPlugin.effect")(function* (ctx: Context) {
        yield* ctx.rpc.register(SettingsRpc.Definition, createSettingsRpcHandlers(options, ctx.location))
      })(ctx).pipe(Effect.orDie),
  })
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  return "Unable to complete the Kilo settings operation"
}
