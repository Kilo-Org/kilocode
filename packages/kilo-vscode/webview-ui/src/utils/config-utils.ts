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

/**
 * Plain-object config state machine — mirrors the SolidJS ConfigProvider
 * logic without signals so the message-handling behavior is unit-testable.
 */
export class ConfigState {
  config: Config = {}
  saved: Config = {}
  draft: Partial<Config> = {}
  dirty = false
  saving = false
  loading = true

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

  /** Handle an incoming configUpdated push from the extension. */
  handleConfigUpdated(server: Config) {
    if (this.saving) {
      this.saving = false
      this.draft = {}
      this.dirty = false
      this.config = server
    } else {
      this.config = resolveConfig(server, this.draft, this.dirty)
    }
    this.saved = server
  }

  /** Send the draft to the backend. */
  saveConfig() {
    if (Object.keys(this.draft).length === 0) return
    this.saving = true
  }

  /** Discard pending changes. */
  discardConfig() {
    this.config = this.saved
    this.draft = {}
    this.dirty = false
  }
}
