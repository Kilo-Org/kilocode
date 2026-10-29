import type { IndexingConfig } from "@kilocode/kilo-indexing/config"
import type { ConfigField } from "../../types/messages/config"

export type IndexingScope = "global" | "project"
export type IndexingInheritance = "none" | "inherited" | "partial" | "managed"
export type IndexingSource = "none" | "global" | "local" | "mixed" | "default" | "managed"

/** Per-field provenance as resolved by the config overlay endpoint, keyed by dotted path. */
export type IndexingFieldInfo = ConfigField

export interface IndexingFieldDisplay {
  value: unknown
  source: IndexingSource
  editable: boolean
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function mergeEffective(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (record(value) && record(result[key])) {
      result[key] = mergeEffective(result[key], value)
      continue
    }
    result[key] = value
  }
  return result
}

function mergeUpdate(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (record(value) && record(result[key])) {
      result[key] = mergeUpdate(result[key], value)
      continue
    }
    result[key] = value
  }
  return result
}

function get(input: IndexingConfig, path: readonly string[]) {
  return path.reduce<unknown>((value, key) => (record(value) ? value[key] : undefined), input)
}

export function indexingConfig(scope: IndexingScope, global: IndexingConfig, project: IndexingConfig) {
  if (scope === "global") return global
  return mergeEffective(global, project) as IndexingConfig
}

export function indexingUpdate(
  scope: IndexingScope,
  global: IndexingConfig,
  project: IndexingConfig,
  patch: IndexingConfig,
) {
  return mergeUpdate(scope === "global" ? global : project, patch) as IndexingConfig
}

export function indexingSource(
  scope: IndexingScope,
  global: IndexingConfig,
  project: IndexingConfig,
  paths: readonly (readonly string[])[],
): IndexingSource {
  if (scope !== "project") return "none"
  const local = paths.filter((path) => get(project, path) !== undefined).length
  const inherited = paths.filter((path) => get(project, path) === undefined && get(global, path) !== undefined).length
  if (local > 0 && inherited > 0) return "mixed"
  if (local > 0) return "local"
  if (inherited > 0) return "global"
  return "default"
}

export function indexingInheritance(
  scope: IndexingScope,
  global: IndexingConfig,
  project: IndexingConfig,
  paths: readonly (readonly string[])[],
): IndexingInheritance {
  const source = indexingSource(scope, global, project, paths)
  if (source === "global") return "inherited"
  if (source === "mixed") return "partial"
  return "none"
}

function resolvedSource(source: IndexingFieldInfo["source"]): IndexingSource {
  if (source === "system") return "managed"
  if (source === "global") return "global"
  if (source === "project") return "local"
  return "default"
}

/**
 * Whether a field can be written at a given scope. Mirrors the config overlay endpoint:
 * `editable: source !== "system" || input.scope === "project"` (opencode/config/overlay.ts).
 *
 * The snapshot fetches the overlay once at project scope, so the stored `editable` flag is
 * project-scoped only. A managed/system field's `source` is "system" regardless of fetch
 * scope (origin is "system" only when no global/local layer defines the value), so recomputing
 * editability here yields the correct per-scope result: locked in the global view, still
 * overridable via project config.
 */
function scopeEditable(source: IndexingFieldInfo["source"], scope: IndexingScope): boolean {
  return source !== "system" || scope === "project"
}

/**
 * Display value for a single indexing field in the given scope.
 * Values from the editable scopes (global/project raw layers, including unsaved edits)
 * win; when neither defines the field, the value resolved by the config overlay is shown —
 * that is where managed/enterprise config, environment, and runtime resolution surface.
 *
 * A field the overlay resolves from a managed/system source is locked in the global view:
 * its effective value wins over any raw-scope value so the input renders disabled instead of
 * showing a stale value that would be rejected on save. In the project view it stays editable,
 * since project config can override a managed value.
 */
export function indexingFieldDisplay(
  scope: IndexingScope,
  global: IndexingConfig,
  project: IndexingConfig,
  fields: Record<string, IndexingFieldInfo> | undefined,
  path: readonly string[],
): IndexingFieldDisplay {
  const resolved = fields?.[`indexing.${path.join(".")}`]
  if (resolved && !scopeEditable(resolved.source, scope)) {
    return { value: resolved.value, source: resolvedSource(resolved.source), editable: false }
  }
  const current = get(indexingConfig(scope, global, project), path)
  if (current !== undefined) {
    return { value: current, source: indexingSource(scope, global, project, [path]), editable: true }
  }
  if (!resolved || resolved.value === undefined) {
    return { value: undefined, source: "default", editable: true }
  }
  return { value: resolved.value, source: resolvedSource(resolved.source), editable: scopeEditable(resolved.source, scope) }
}

export function indexingDescription(description: string, inheritance: IndexingInheritance) {
  if (inheritance === "inherited") return `${description} Inherited from global config.`
  if (inheritance === "partial") return `${description} Some values are inherited from global config.`
  if (inheritance === "managed") return `${description} Inherited from managed config.`
  return description
}

export function indexingEnabled(scope: IndexingScope, global: IndexingConfig, project: IndexingConfig) {
  return indexingConfig(scope, global, project).enabled === true
}

export function indexingEnabledInherited(scope: IndexingScope, global: IndexingConfig, project: IndexingConfig) {
  return indexingInheritance(scope, global, project, [["enabled"]]) === "inherited"
}
