import type { OpenCodeClient } from "@opencode-ai/client/promise"
import {
  SETTINGS_FIELD_KEYS,
  SettingsRpc,
  type SettingsExpected,
  type SettingsFieldKey,
  type SettingsScopeState,
  type SettingsSnapshot,
} from "@opencode-ai/schema/kilocode/settings"
import { result, type AdapterOptions } from "./result"
import type { Config } from "./view-types"

/**
 * Bounded translation of the v1 VS Code extension's config surface
 * (config.get / global.config.get / update / overlay / overlayUpdate) onto the
 * native v2 client and the public `kilocode.settings` RPC. Scope naming maps
 * v1 "global" to the v2 "profile" scope; revision authority is the settings
 * store's own optimistic-concurrency token (path + sha256, null for a first
 * write).
 *
 * Writable surface: the managed settings field keys plus the collection
 * config writes (providers, agents, permissions, generated provider policies)
 * through the same store queue and revision authority. Authored fields outside
 * that set fail explicitly with the offending key names; nothing is silently
 * dropped or accepted. MCP has its own native API and never rides config.
 */

export type SettingsScopeName = "global" | "project"

export type SettingsTarget = {
  scope: SettingsScopeName
  path: string
  revision: string | null
  exists: boolean
  writable: boolean
  /** The scope's own resolved document; the only place Kilo-only keys surface. */
  raw: Partial<Config>
}

export type SettingsOverlayField = {
  key: string
  path: string[]
  value?: unknown
  global?: unknown
  local?: unknown
  source: "project" | "global" | "system" | "default"
  inherited: boolean
  overridden: boolean
  editable: boolean
  reason?: string
}

export type SettingsOverlayResponse = {
  scope: SettingsScopeName
  effective: Partial<Config>
  global: Partial<Config>
  project: Partial<Config>
  targets: { global: SettingsTarget; project: SettingsTarget; active: SettingsTarget }
  fields: Record<string, SettingsOverlayField>
  collections: Record<string, SettingsOverlayField[]>
}

/**
 * Authored v1 top-level keys (and dotted v2 keys) → managed settings field
 * keys. Every entry is an exact semantic match: `snapshot` is the v1 spelling
 * of `snapshots`, and the v1 runtime consumed top-level `subagent_depth`
 * (pinned `packages/opencode/src/tool/task.ts:135`) where v2 consumes
 * `experimental.subagent_depth`.
 */
const MANAGED_TREE: Record<
  string,
  SettingsFieldKey | Record<string, SettingsFieldKey | Record<string, SettingsFieldKey>>
> = {
  model: "model",
  default_agent: "default_agent",
  shell: "shell",
  snapshots: "snapshots",
  snapshot: "snapshots",
  websearch: "websearch",
  warming: "warming",
  hide_prompt_training_models: "hide_prompt_training_models",
  subagent_depth: "experimental.subagent_depth",
  tool_output: {
    max_lines: "tool_output.max_lines",
    max_bytes: "tool_output.max_bytes",
  },
  media: {
    image: {
      auto_resize: "media.image.auto_resize",
      max_width: "media.image.max_width",
      max_height: "media.image.max_height",
      max_base64_bytes: "media.image.max_base64_bytes",
    },
  },
  compaction: {
    auto: "compaction.auto",
    buffer: "compaction.buffer",
    keep: { tokens: "compaction.keep.tokens" },
  },
  experimental: {
    subagent_depth: "experimental.subagent_depth",
    portable_shell_scanner: "experimental.portable_shell_scanner",
  },
}

type ManagedLeaf = { key: SettingsFieldKey; value?: unknown }

function isFieldKey(key: string): key is SettingsFieldKey {
  return (SETTINGS_FIELD_KEYS as readonly string[]).includes(key)
}

function refuseUnsupported(names: Array<string>): never {
  throw new Error(
    `Kilo settings adapter manages only [${SETTINGS_FIELD_KEYS.join(", ")}]; unsupported config keys: ${names.join(", ")}`,
  )
}

/** Resolve an authored partial-config object into managed leaf writes. */
function resolveSet(authored: Record<string, unknown> | undefined): Array<ManagedLeaf> {
  const unsupported: Array<string> = []
  const subtreeLeaves: Array<ManagedLeaf> = []
  const directLeaves: Array<ManagedLeaf> = []
  for (const [key, value] of Object.entries(authored ?? {})) {
    if (value === undefined) continue
    const direct = isFieldKey(key) ? key : (MANAGED_TREE[key] as SettingsFieldKey | undefined)
    if (typeof direct === "string") {
      directLeaves.push({ key: direct, value })
      continue
    }
    const subtree = (MANAGED_TREE[key] ?? {}) as Record<string, SettingsFieldKey>
    if (Object.keys(subtree).length === 0) {
      unsupported.push(key)
      continue
    }
    if (value === null || typeof value !== "object") {
      unsupported.push(key)
      continue
    }
    for (const [child, nested] of Object.entries(value)) {
      const leaf = subtree[child]
      if (typeof leaf !== "string") {
        unsupported.push(`${key}.${child}`)
        continue
      }
      if (nested === undefined) continue
      subtreeLeaves.push({ key: leaf, value: nested })
    }
  }
  if (unsupported.length > 0) refuseUnsupported(unsupported)
  // The pinned v1 runtime consumed only the top-level forms, so a direct leaf
  // wins over a nested leaf resolving to the same settings key, and writes
  // land nested-first so that precedence holds on disk.
  const byKey = new Map<SettingsFieldKey, ManagedLeaf>()
  for (const leaf of subtreeLeaves) byKey.set(leaf.key, leaf)
  for (const leaf of directLeaves) byKey.set(leaf.key, leaf)
  return [...byKey.values()]
}

/** Resolve v1 overlay `unset` leaf paths into managed field resets. */
function resolveUnset(unset: ReadonlyArray<ReadonlyArray<string>> | undefined): Array<ManagedLeaf> {
  const unsupported: Array<string> = []
  const leaves: Array<ManagedLeaf> = []
  for (const path of unset ?? []) {
    const key = path.join(".")
    if (!isFieldKey(key)) {
      unsupported.push(key)
      continue
    }
    leaves.push({ key })
  }
  if (unsupported.length > 0) refuseUnsupported(unsupported)
  return leaves
}

function v2Scope(scope: SettingsScopeName): "profile" | "project" {
  return scope === "global" ? "profile" : "project"
}

function scopeState(snapshot: SettingsSnapshot, scope: SettingsScopeName): SettingsScopeState {
  const found = snapshot.scopes.find((item) => item.scope === v2Scope(scope))
  if (!found) throw new Error(`The ${scope} configuration scope is not available`)
  return found
}

/** Fold decoded native documents lowest-to-highest priority, then Kilo-only keys. */
function fold(documents: ReadonlyArray<{ info: unknown }>): Partial<Config> {
  const view: Record<string, unknown> = {}
  for (const entry of documents) {
    if (entry.info === undefined || entry.info === null || typeof entry.info !== "object") continue
    Object.assign(view, entry.info)
  }
  return view as Partial<Config>
}

/**
 * The transplanted host reads the v1 `plugin` tuple shape (`features.ts`);
 * the native decode only carries the v2 `plugins` entries, so translate them
 * without inventing any other key.
 */
function withCompat(view: Record<string, unknown>): Partial<Config> {
  if (view.plugins !== undefined && view.plugin === undefined) {
    view.plugin = (view.plugins as Array<unknown>).map((entry) =>
      typeof entry === "string"
        ? entry
        : [(entry as { package: string }).package, (entry as { options?: Record<string, unknown> }).options ?? {}],
    )
  }
  return view as Partial<Config>
}

export function createSettingsMethods(client: OpenCodeClient, defaultDirectory: string) {
  const settings = client.rpc(SettingsRpc.Definition)

  const location = (input: { directory?: string; workspace?: string } | undefined) => ({
    directory: input?.directory ?? defaultDirectory,
    ...(input?.workspace === undefined ? {} : { workspace: input.workspace }),
  })

  /**
   * The settings store reads its target files fresh on every call, while the
   * host's native config projection only refreshes on restart
   * (`restartRequired`), so managed values from the snapshot override the
   * possibly stale native fold in every view this adapter reports.
   */
  function managed(
    snapshot: SettingsSnapshot,
    pick: (field: SettingsSnapshot["fields"][number]) => unknown,
  ): Partial<Config> {
    const view: Record<string, unknown> = {}
    for (const field of snapshot.fields) {
      const value = pick(field)
      if (value === undefined) continue
      let node = view
      const path = field.key.split(".")
      for (const segment of path.slice(0, -1)) {
        const child = node[segment]
        const parent =
          child !== undefined && child !== null && typeof child === "object" ? (child as Record<string, unknown>) : {}
        node[segment] = parent
        node = parent
      }
      node[path.at(-1)!] = value
    }
    return view as Partial<Config>
  }

  const COLLECTION_FIELDS = ["providers", "agents", "permissions", "policies"] as const

  /**
   * The original custom-provider spec (zod shape in shared/custom-provider.ts)
   * mapped onto the native ConfigProvider.Info. Fields with no native
   * equivalent are refused, never silently dropped.
   */
  function translateProviderSpec(spec: Record<string, unknown>): Record<string, unknown> {
    const unsupported = Object.keys(spec).filter((key) => !["npm", "name", "env", "options", "models"].includes(key))
    if (unsupported.length > 0) {
      throw new Error(`The provider entry has unsupported fields: ${unsupported.join(", ")}`)
    }
    const models: Record<string, unknown> = {}
    const modelUnsupported: Array<string> = []
    for (const [id, raw] of Object.entries((spec.models ?? {}) as Record<string, Record<string, unknown>>)) {
      const unknown = Object.keys(raw).filter((key) => !["name", "reasoning", "modalities", "variants"].includes(key))
      if (unknown.length > 0) modelUnsupported.push(...unknown.map((key) => `models.${id}.${key}`))
      if (raw.reasoning !== undefined) modelUnsupported.push(`models.${id}.reasoning`)
      const modalities = raw.modalities as { input?: string[]; output?: string[] } | undefined
      const variants = raw.variants as Record<string, unknown> | undefined
      models[id] = {
        ...(raw.name === undefined ? {} : { name: raw.name }),
        ...(modalities === undefined
          ? {}
          : {
              capabilities: { tools: true, input: modalities.input ?? ["text"], output: modalities.output ?? ["text"] },
            }),
        ...(variants === undefined
          ? {}
          : {
              variants: Object.entries(variants).map(([variantID, config]) => ({
                id: variantID,
                ...(config as Record<string, unknown>),
              })),
            }),
      }
    }
    if (modelUnsupported.length > 0) {
      throw new Error(`The provider entry has unsupported fields: ${modelUnsupported.join(", ")}`)
    }
    const options = (spec.options ?? {}) as { baseURL?: string; headers?: Record<string, string> }
    return {
      ...(spec.name === undefined ? {} : { name: spec.name }),
      ...(spec.npm === undefined ? {} : { package: spec.npm }),
      ...(spec.env === undefined ? {} : { env: spec.env }),
      ...(options.baseURL === undefined ? {} : { settings: { baseURL: options.baseURL } }),
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      models,
    }
  }

  /**
   * The original work-style permission record maps onto the native ruleset:
   * every pattern rule targeted shell commands (v1 permission config keys),
   * and the shell tool asserts permissions with its tool name as the action.
   */
  function translatePermissionRules(record: Record<string, unknown>): Array<Record<string, unknown>> {
    return Object.entries(record).map(([pattern, effect]) => {
      if (effect !== "allow" && effect !== "deny" && effect !== "ask") {
        throw new Error(`The permission rule for "${pattern}" is not an allow/ask/deny effect`)
      }
      return { action: "shell", resource: pattern, effect }
    })
  }

  /**
   * The native provider entries projected back onto the original custom-provider
   * spec shape. Losses are documented gates: the v1 reasoning flag has no v2
   * equivalent and non-shell permission rules cannot be expressed in the v1
   * permission record.
   */
  function reverseProviderSpec(entry: Record<string, unknown>): Record<string, unknown> {
    const settings = (entry.settings ?? {}) as { baseURL?: string }
    return {
      npm: "openai-compatible",
      ...(entry.name === undefined ? {} : { name: entry.name }),
      ...(entry.env === undefined ? {} : { env: entry.env }),
      ...(settings.baseURL === undefined
        ? {}
        : {
            options: { baseURL: settings.baseURL, ...(entry.headers === undefined ? {} : { headers: entry.headers }) },
          }),
      ...(entry.models === undefined
        ? {}
        : {
            models: Object.fromEntries(
              Object.entries(entry.models as Record<string, Record<string, unknown>>).map(([id, model]) => [
                id,
                {
                  ...(model.name === undefined ? {} : { name: model.name }),
                  ...(model.capabilities === undefined
                    ? {}
                    : {
                        modalities: {
                          input: (model.capabilities as { input?: string[] }).input,
                          output: (model.capabilities as { output?: string[] }).output,
                        },
                      }),
                  ...(model.variants === undefined
                    ? {}
                    : {
                        variants: Object.fromEntries(
                          (model.variants as Array<{ id: string } & Record<string, unknown>>).map((variant) => [
                            variant.id,
                            variant,
                          ]),
                        ),
                      }),
                },
              ]),
            ),
          }),
    }
  }

  /**
   * Collection entries ride the fresh settings-store reads (the native config
   * projection only refreshes on restart) and are projected onto the original
   * singular wire names the transplanted host reads.
   */
  function overlayRecord(
    view: Record<string, unknown>,
    wire: string,
    entries: Record<string, unknown>,
    reverse: boolean,
  ) {
    const current = (view[wire] as Record<string, unknown> | undefined) ?? {}
    view[wire] = {
      ...current,
      ...Object.fromEntries(
        Object.entries(entries).map(([key, value]) => [
          key,
          reverse && isObjectValue(value) ? reverseProviderSpec(value) : value,
        ]),
      ),
    }
  }

  function overlayRules(
    view: Record<string, unknown>,
    wire: string,
    rules: ReadonlyArray<Record<string, unknown>>,
    action: string,
  ) {
    const applicable = rules.filter((rule) => rule.action === action)
    if (applicable.length === 0) return
    view[wire] = Object.fromEntries(applicable.map((rule) => [rule.resource as string, rule.effect]))
  }

  function overlayDisabled(view: Record<string, unknown>, policies: ReadonlyArray<Record<string, unknown>>) {
    view.disabled_providers = policies
      .filter((policy) => policy.action === "provider.use" && policy.effect === "deny")
      .map((policy) => policy.resource)
  }

  function isObjectValue(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  async function views(input: { directory?: string; workspace?: string } | undefined, options?: AdapterOptions) {
    const at = location(input)
    const [snapshot, entries] = await Promise.all([
      settings.read({}, { ...options, location: at }),
      client.config.get({ location: at }, options),
    ])
    const profilePath = scopeState(snapshot, "global").path
    const documents = entries.flatMap((entry) =>
      entry.type === "document" && entry.path !== undefined ? [{ path: entry.path, info: entry.info }] : [],
    )
    const profileDocuments = documents.filter((entry) => entry.path === profilePath)
    const projectDocuments = documents.filter((entry) => entry.path !== profilePath)
    const globalView = withCompat({ ...fold(profileDocuments), ...managed(snapshot, (field) => field.values.profile) })
    const projectView = withCompat({ ...fold(projectDocuments), ...managed(snapshot, (field) => field.values.project) })
    const effective = withCompat({
      ...fold(documents),
      ...managed(snapshot, (field) => field.values.project ?? field.values.profile),
    })
    for (const [collection, scope, view] of [
      ["providers", "profile", globalView],
      ["providers", "project", projectView],
      ["agents", "profile", globalView],
      ["agents", "project", projectView],
      ["permissions", "profile", globalView],
      ["permissions", "project", projectView],
      ["policies", "profile", globalView],
      ["policies", "project", projectView],
    ] as const) {
      const collectionSnapshot = (await settings.collectionGet(
        { collection, scope },
        { ...options, location: at },
      )) as {
        entries: Record<string, unknown>
      }
      if (collection === "providers")
        overlayRecord(view as Record<string, unknown>, "provider", collectionSnapshotEntries(collectionSnapshot), true)
      if (collection === "agents")
        overlayRecord(view as Record<string, unknown>, "agent", collectionSnapshotEntries(collectionSnapshot), false)
      if (collection === "permissions")
        overlayRules(view as Record<string, unknown>, "permission", rulesOf(collectionSnapshot), "shell")
      if (collection === "policies") overlayDisabled(view as Record<string, unknown>, rulesOf(collectionSnapshot))
    }
    return {
      snapshot,
      globalView: globalView as Partial<Config>,
      projectView: projectView as Partial<Config>,
      effective: effective as Partial<Config>,
    }
  }

  function collectionSnapshotEntries(snapshot: { entries: Record<string, unknown> }): Record<string, unknown> {
    return snapshot.entries
  }

  function rulesOf(snapshot: { entries: Record<string, unknown> }): ReadonlyArray<Record<string, unknown>> {
    const value = snapshot.entries[""]
    return Array.isArray(value) ? (value as ReadonlyArray<Record<string, unknown>>) : []
  }

  function target(state: SettingsScopeState, name: SettingsScopeName, raw: Partial<Config>): SettingsTarget {
    return {
      scope: name,
      path: state.path,
      revision: state.expected?.revision ?? null,
      exists: state.exists,
      writable: state.writable,
      raw,
    }
  }

  function overlayFields(snapshot: SettingsSnapshot, scope: SettingsScopeName): Record<string, SettingsOverlayField> {
    const active = scopeState(snapshot, scope)
    const fields: Record<string, SettingsOverlayField> = {}
    for (const field of snapshot.fields) {
      const global = field.values.profile
      const local = field.values.project
      const source = field.source === "project" ? "project" : field.source === "profile" ? "global" : "default"
      const reason = field.invalid ?? (active.writable ? undefined : active.reason)
      fields[field.key] = {
        key: field.key,
        path: field.key.split("."),
        ...(field.source === "unset"
          ? {}
          : { value: field.source === "project" ? field.values.project : field.values.profile }),
        ...(global === undefined ? {} : { global }),
        ...(local === undefined ? {} : { local }),
        source,
        inherited: source === "global",
        overridden: source === "project" && global !== undefined,
        editable: active.writable && field.invalid === undefined,
        ...(reason === undefined ? {} : { reason }),
      }
    }
    return fields
  }

  async function overlayResponse(
    input: { directory?: string; workspace?: string; scope?: SettingsScopeName } | undefined,
    options?: AdapterOptions,
  ): Promise<SettingsOverlayResponse> {
    const scope = input?.scope ?? "project"
    const { snapshot, globalView, projectView, effective } = await views(input, options)
    const targets = {
      global: target(scopeState(snapshot, "global"), "global", globalView),
      project: target(scopeState(snapshot, "project"), "project", projectView),
    }
    return {
      scope,
      effective,
      global: globalView,
      project: projectView,
      targets: { ...targets, active: targets[scope] },
      fields: overlayFields(snapshot, scope),
      collections: {},
    }
  }

  /**
   * Apply managed leaves sequentially against the scope target. The caller's
   * `expected` guards the first write exactly like the v1 overlay revision;
   * later writes carry the fresh revision this patch itself produced, so an
   * external change still fails the whole patch at the first write. Unlike
   * the v1 server's single write, a hard failure mid-patch can leave earlier
   * managed keys applied — unsupported fields are refused before any write.
   */
  async function apply(
    input: {
      scope: SettingsScopeName
      set?: Record<string, unknown>
      unset?: ReadonlyArray<ReadonlyArray<string>>
      directory?: string
      workspace?: string
      expected?: SettingsExpected
    },
    options?: AdapterOptions,
  ): Promise<SettingsOverlayResponse> {
    const at = location(input)
    const authored = input.set ?? {}
    const managedAuthored: Record<string, unknown> = {}
    const policiesValue = Array.isArray(authored.disabled_providers)
      ? await policiesForDisabledList(authored.disabled_providers as Array<string>, input, options)
      : undefined
    const collectionOps: Array<{
      collection: "providers" | "agents" | "permissions" | "policies"
      key?: string
      value?: unknown
      unset?: boolean
    }> = []
    for (const [key, value] of Object.entries(authored)) {
      if (key === "provider" || key === "agents") {
        const entries = value as Record<string, unknown> | undefined
        if (entries === undefined || entries === null || !isObjectValue(entries)) {
          if (value !== undefined) throw new Error(`The ${key} entry is not a record of provider configurations`)
          continue
        }
        const targetCollection = key === "provider" ? "providers" : "agents"
        for (const [id, spec] of Object.entries(entries)) {
          // The original removal marker was a null entry; the v2 seam removes
          // the leaf outright instead of storing a null the host would drop.
          if (spec === null) {
            collectionOps.push({ collection: targetCollection, key: id, unset: true })
            continue
          }
          collectionOps.push({
            collection: targetCollection,
            key: id,
            value: key === "provider" ? translateProviderSpec(asRecord(spec, key)) : spec,
          })
        }
        continue
      }
      if (key === "permission") {
        const record = value as Record<string, unknown> | undefined
        if (record === undefined) continue
        if (!isObjectValue(record)) throw new Error("The permission value is not a record of allow/ask/deny rules")
        collectionOps.push({ collection: "permissions", value: translatePermissionRules(record) })
        continue
      }
      if (key === "disabled_providers") {
        if (!Array.isArray(value)) throw new Error("The disabled_providers value is not an array of provider ids")
        collectionOps.push({ collection: "policies", value: policiesValue })
        continue
      }
      if (isFieldKey(key)) {
        if (value === undefined) continue
        managedAuthored[key] = value
        continue
      }
      const nested = MANAGED_TREE[key]
      if (nested === undefined) {
        throw new Error(
          `Kilo settings adapter manages only [${SETTINGS_FIELD_KEYS.join(", ")}] and the provider, agents, permission, disabled_providers collections; unsupported config keys: ${key}`,
        )
      }
      managedAuthored[key] = value
    }
    const setLeaves = resolveSet(managedAuthored)
    const unsetLeaves = resolveUnset(input.unset)
    if (setLeaves.length === 0 && unsetLeaves.length === 0 && collectionOps.length === 0) {
      return overlayResponse(input, options)
    }
    const snapshot = await settings.read({}, { ...options, location: at })
    const state = scopeState(snapshot, input.scope)
    if (!state.writable) throw new Error(state.reason ?? `The ${input.scope} configuration target is not writable`)
    let current = input.expected ?? state.expected
    for (const operation of collectionOps) {
      const change =
        "unset" in operation
          ? await settings.collectionUnset(
              {
                scope: state.scope,
                collection: operation.collection,
                ...(operation.key === undefined ? {} : { key: operation.key }),
                ...(current === undefined ? {} : { expected: current }),
              },
              { ...options, location: at },
            )
          : await settings.collectionSet(
              {
                scope: state.scope,
                collection: operation.collection,
                ...(operation.key === undefined ? {} : { key: operation.key }),
                value: operation.value as never,
                ...(current === undefined ? {} : { expected: current }),
              },
              { ...options, location: at },
            )
      current = scopeState(change.snapshot, input.scope).expected
    }
    for (const leaf of setLeaves) {
      const change = await settings.set(
        {
          scope: state.scope,
          key: leaf.key,
          value: leaf.value as never,
          ...(current === undefined ? {} : { expected: current }),
        },
        { ...options, location: at },
      )
      current = scopeState(change.snapshot, input.scope).expected
    }
    for (const leaf of unsetLeaves) {
      const change = await settings.reset(
        { scope: state.scope, key: leaf.key, ...(current === undefined ? {} : { expected: current }) },
        { ...options, location: at },
      )
      current = scopeState(change.snapshot, input.scope).expected
    }
    return overlayResponse(input, options)
  }

  function asRecord(value: unknown, key: string): Record<string, unknown> {
    if (!isObjectValue(value)) throw new Error(`The ${key} entry is not an object`)
    return value
  }

  /**
   * The v1 disabled_providers list rides the generated provider policy
   * ruleset: pre-existing policies that are not provider-use denies are kept,
   * and every listed provider gains a deny.
   */
  async function policiesForDisabledList(
    disabled: ReadonlyArray<string>,
    input: { directory?: string; workspace?: string; scope?: SettingsScopeName },
    options?: AdapterOptions,
  ): Promise<Array<Record<string, unknown>>> {
    const merged = (await settings.collectionGet(
      { collection: "policies", scope: input.scope === undefined || input.scope === "global" ? "profile" : "project" },
      { ...options, location: location(input) },
    )) as { entries: Record<string, unknown> }
    const existing = rulesOf(merged).filter(
      (policy) =>
        !(policy.action === "provider.use" && policy.effect === "deny" && disabled.includes(policy.resource as string)),
    )
    return [
      ...existing.filter((policy) => !(policy.action === "provider.use" && policy.effect === "deny")),
      ...disabled.map((id) => ({ action: "provider.use", resource: id, effect: "deny" })),
    ]
  }

  return {
    config: {
      get: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string } = {},
        options?: AdapterOptions<Throw>,
      ) => result(async () => (await views(input, options)).effective, options),
      update: <Throw extends boolean = false>(
        input: { config: Partial<Config>; directory?: string; workspace?: string },
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          const response = await apply(
            { scope: "project", set: input.config, directory: input.directory, workspace: input.workspace },
            options,
          )
          return response.effective
        }, options),
      overlay: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string; scope?: SettingsScopeName } = {},
        options?: AdapterOptions<Throw>,
      ) => result(async () => overlayResponse(input, options), options),
      overlayUpdate: <Throw extends boolean = false>(
        input: {
          scope: SettingsScopeName
          set?: Record<string, unknown>
          unset?: ReadonlyArray<ReadonlyArray<string>>
          directory?: string
          workspace?: string
          expected?: SettingsExpected
        },
        options?: AdapterOptions<Throw>,
      ) => result(async () => apply(input, options), options),
      /** The host config-normalize diagnostics, per source document. */
      warnings: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string } = {},
        options?: AdapterOptions<Throw>,
      ) => result(async () => settings.warnings({}, { ...options, location: location(input) }), options),
      /** The host config reload seam; the marketplace and host callers use it after writes. */
      refresh: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string } = {},
        options?: AdapterOptions<Throw>,
      ) => result(async () => settings.refresh({}, { ...options, location: location(input) }), options),
    },
    global: {
      config: {
        get: <Throw extends boolean = false>(_input: Record<string, never> = {}, options?: AdapterOptions<Throw>) =>
          result(async () => (await views(undefined, options)).globalView, options),
        update: <Throw extends boolean = false>(
          input: { config: Partial<Config>; directory?: string; workspace?: string },
          options?: AdapterOptions<Throw>,
        ) =>
          result(async () => {
            const response = await apply(
              { scope: "global", set: input.config, directory: input.directory, workspace: input.workspace },
              options,
            )
            return response.effective
          }, options),
      },
    },
  }
}
