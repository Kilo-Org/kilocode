import type { Config } from "../types/messages"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/** Deep merge two objects, with source values overriding target values. */
export function deepMerge(target: Config, source: Partial<Config>): Config {
  const result: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = deepMerge(result[key] as Config, value as Partial<Config>)
    } else {
      result[key] = value
    }
  }
  return result as Config
}

function stripUndefined(value: unknown): unknown {
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (item === undefined) return []
      return [[key, stripUndefined(item)]]
    }),
  )
}

/** Merge raw scoped config while preserving schema-valid indexing null overrides. */
export function mergeScopedConfig(target: Config, source: Partial<Config>): Config {
  const merged = deepMerge(target, source)
  const result = stripNulls(merged)
  if (isRecord(merged.indexing)) result.indexing = stripUndefined(merged.indexing) as Config["indexing"]
  return result
}

function indexingNull(path: readonly string[]) {
  return path.length === 2 && path[0] === "indexing" && (path[1] === "model" || path[1] === "dimension")
}

export function configUnsetPaths(value: unknown, prefix: string[] = []): string[][] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, item]) => {
    const path = [...prefix, key]
    if (item === undefined || (item === null && !indexingNull(path))) return [path]
    return configUnsetPaths(item, path)
  })
}

/** Prepare an overlay set payload while preserving schema-valid indexing null overrides. */
export function pruneConfigSet(value: unknown, prefix: string[] = []): unknown {
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const path = [...prefix, key]
      if (item === undefined || (item === null && !indexingNull(path))) return []
      const next = pruneConfigSet(item, path)
      if (path[0] === "indexing" && isRecord(next) && Object.keys(next).length === 0) return []
      return [[key, next]]
    }),
  )
}

/** Recursively remove keys whose value is null (null = "deleted"). */
export function stripNulls(obj: Config): Config {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    if (isRecord(value)) {
      result[key] = stripNulls(value as Config)
    } else {
      result[key] = value
    }
  }
  return result as Config
}

/**
 * Resolve the visible config when a configLoaded/configUpdated message arrives.
 * If the user has pending draft changes, re-apply the draft on top of the
 * incoming server config so pending toggles don't snap back.
 */
export function resolveConfig(server: Config, draft: Partial<Config>, dirty: boolean): Config {
  if (dirty) return stripNulls(deepMerge(server, draft))
  return server
}

/** Remove one MCP server from resolved, saved, or draft config state. */
export function removeMcpConfig(config: Config, name: string): Config {
  if (!config.mcp || !(name in config.mcp)) return config
  const mcp = { ...config.mcp }
  delete mcp[name]
  const next: Config = { ...config, mcp }
  if (Object.keys(mcp).length === 0) delete next.mcp
  return next
}

export function hideRemovedMcp(config: Config, names: Iterable<string>): Config {
  let next = config
  for (const name of names) next = removeMcpConfig(next, name)
  return next
}

export function retainUnconfirmedMcpRemovals(names: Iterable<string>, config: Config): Set<string> {
  return new Set([...names].filter((name) => Boolean(config.mcp?.[name])))
}

let saveCount = 0
/**
 * A fresh id for one `saveConfig` write. The host echoes it on the one message that answers
 * that write, so a `configUpdated` from any other writer cannot settle the save.
 */
const nextSaveId = () => `s${(saveCount += 1).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Plain-object config state machine — mirrors the SolidJS ConfigProvider
 * logic without signals so the message-handling behavior is unit-testable.
 *
 * It models the message-shaped parts: which push settles which write, and what
 * stays pending after a failure. Like the settings-write chains, it keeps no
 * timers, so the bound that lets the provider settle a save the host never
 * answers lives only in the provider; a save this model marks `saving` stays
 * that way until an answer settles it.
 */
export class ConfigState {
  config: Config = {}
  saved: Config = {}
  draft: Partial<Config> = {}
  dirty = false
  saving = false
  loading = true
  /** The id of the write `saving` waits on; only the answer that echoes it confirms. */
  request: string | undefined = undefined

  /** Accumulate a partial change (same as the toggle click path). */
  updateConfig(partial: Partial<Config>) {
    this.config = stripNulls(deepMerge(this.config, partial))
    this.draft = deepMerge(this.draft as Config, partial)
    this.dirty = true
  }

  /** Handle an incoming configLoaded push from the extension. */
  handleConfigLoaded(server: Config) {
    if (this.saving) return
    this.config = resolveConfig(server, this.draft, this.dirty)
    this.saved = server
    this.loading = false
  }

  removeMcp(name: string) {
    this.config = removeMcpConfig(this.config, name)
    this.saved = removeMcpConfig(this.saved, name)
    this.draft = removeMcpConfig(this.draft as Config, name)
    this.dirty = Object.keys(this.draft).length > 0
  }

  /**
   * Handle an incoming configUpdated push from the extension. Only the message that echoes
   * the in-flight write's request id confirms it; any other push — another webview's save, a
   * provider action, an SSE-driven refresh — re-applies the draft and leaves `saving` alone.
   */
  handleConfigUpdated(server: Config, requestId?: string) {
    if (this.saving && requestId != null && requestId === this.request) {
      this.request = undefined
      this.saving = false
      this.draft = {}
      this.dirty = false
      this.config = server
    } else {
      this.config = resolveConfig(server, this.draft, this.dirty)
    }
    this.saved = server
  }

  /** Handle a confirmed save when merged config refresh is still pending. */
  handleConfigSaved() {
    if (!this.saving) return
    this.saving = false
    this.request = undefined
    this.draft = {}
    this.dirty = false
    this.saved = this.config
  }

  /**
   * Handle an explicit save failure from the extension. A failure that names another
   * writer's request cannot be the answer to this save, so while a save is in flight it
   * leaves `saving`, the draft, and `dirty` alone — the same guard the provider applies.
   */
  handleConfigSaveFailed(server: Config, requestId?: string) {
    if (!this.saving) return
    if (requestId != null && requestId !== this.request) return
    this.saving = false
    this.request = undefined
    this.saved = server
    this.config = resolveConfig(server, this.draft, this.dirty)
  }

  /** Send the draft to the backend. */
  saveConfig() {
    if (this.saving || Object.keys(this.draft).length === 0) return
    this.saving = true
    this.request = nextSaveId()
  }

  /** Discard pending changes. */
  discardConfig() {
    this.config = this.saved
    this.draft = {}
    this.dirty = false
    this.request = undefined
  }
}
