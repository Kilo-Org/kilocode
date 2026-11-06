import type { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"

export type IndexingConfig = KiloIndexingRpc.Config

export type IndexingScope = "global" | "project"
export type IndexingInheritance = "none" | "inherited" | "partial"
export type IndexingSource = "none" | "global" | "local" | "mixed" | "default"

export const DEFAULT_VECTOR_STORE = "lancedb" as const

const FILE_EXTENSION_PATTERN = /^\.?[A-Za-z0-9][A-Za-z0-9_+-]*$/

export function isFileExtension(input: string): boolean {
  return FILE_EXTENSION_PATTERN.test(input.trim())
}

export function normalizeFileExtensions(input: readonly string[] | undefined): string[] | undefined {
  if (!input) return undefined
  const values = new Set<string>()
  for (const raw of input) {
    const item = raw.trim().toLowerCase()
    if (!item) continue
    values.add(item.startsWith(".") ? item : `.${item}`)
  }
  return values.size > 0 ? [...values].sort() : undefined
}

export function parseFileExtensions(input: string): string[] | undefined {
  const values = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length > 0 ? normalizeFileExtensions(values) : undefined
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

export function indexingDescription(description: string, inheritance: IndexingInheritance) {
  if (inheritance === "inherited") return `${description} Inherited from global config.`
  if (inheritance === "partial") return `${description} Some values are inherited from global config.`
  return description
}

export function indexingEnabled(scope: IndexingScope, global: IndexingConfig, project: IndexingConfig) {
  return indexingConfig(scope, global, project).enabled === true
}

export function indexingEnabledInherited(scope: IndexingScope, global: IndexingConfig, project: IndexingConfig) {
  return indexingInheritance(scope, global, project, [["enabled"]]) === "inherited"
}
