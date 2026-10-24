import type { IndexingConfig } from "@kilocode/kilo-indexing/config"

export type IndexingScope = "global" | "project"
export type IndexingInheritance = "none" | "inherited" | "partial" | "managed"
export type IndexingSource = "none" | "global" | "local" | "mixed" | "default" | "managed"

/** Per-field provenance as resolved by the config overlay endpoint, keyed by dotted path. */
export interface IndexingFieldInfo {
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

/**
 * Display value for a single indexing field in the given scope.
 * Values from the editable scopes (global/project raw layers, including unsaved edits)
 * win; when neither defines the field, the value resolved by the config overlay is shown —
 * that is where managed/enterprise config, environment, and runtime resolution surface.
 */
export function indexingFieldDisplay(
  scope: IndexingScope,
  global: IndexingConfig,
  project: IndexingConfig,
  fields: Record<string, IndexingFieldInfo> | undefined,
  path: readonly string[],
): IndexingFieldDisplay {
  const current = get(indexingConfig(scope, global, project), path)
  if (current !== undefined) {
    return { value: current, source: indexingSource(scope, global, project, [path]), editable: true }
  }
  const resolved = fields?.[`indexing.${path.join(".")}`]
  if (!resolved || resolved.value === undefined) {
    return { value: undefined, source: "default", editable: true }
  }
  const source =
    resolved.source === "system"
      ? "managed"
      : resolved.source === "global"
        ? "global"
        : resolved.source === "project"
          ? "local"
          : "default"
  return { value: resolved.value, source, editable: resolved.editable }
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
