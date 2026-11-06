import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import { createMemo, type Accessor } from "solid-js"

export type IndexingScope = KiloIndexingRpc.Scope
export type IndexingConfig = KiloIndexingRpc.Config
export type KiloEmbeddingModelCatalog = KiloGatewayRpc.EmbeddingCatalog

export async function loadKiloEmbeddingModels(
  load: () => Promise<KiloEmbeddingModelCatalog>,
  onError?: (message: string) => void,
) {
  return load().catch((error: unknown) => {
    onError?.(errorMessage(error))
    throw error
  })
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}

export function kiloModelOptions(catalog?: KiloEmbeddingModelCatalog) {
  if (!catalog) return [{ value: "", title: "Loading supported models..." }]
  if (catalog.models.length === 0) return [{ value: "", title: "No supported models available" }]
  return catalog.models.map((model) => ({
    value: model.id,
    title: `${model.name} (${model.note ? `${model.note}, ` : ""}${model.dimension}d)`,
  }))
}

export function currentKiloModel(catalog: KiloEmbeddingModelCatalog | undefined, model?: string | null) {
  if (!catalog) return undefined
  const fallback = catalog.aliases[catalog.defaultModel] ?? catalog.defaultModel
  const current = model ? (catalog.aliases[model] ?? model) : fallback
  return catalog.models.some((item) => item.id === current) ? current : fallback
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function get(input: IndexingConfig, path: readonly string[]) {
  return path.reduce<unknown>((value, key) => (record(value) ? value[key] : undefined), input)
}

export type IndexingInheritance = "none" | "inherited" | "partial"

export function indexingInheritance(
  scope: IndexingScope,
  global: IndexingConfig,
  project: IndexingConfig,
  paths: readonly (readonly string[])[],
): IndexingInheritance {
  if (scope !== "project") return "none"
  const configured = paths.filter((path) => get(global, path) !== undefined || get(project, path) !== undefined)
  const inherited = configured.filter((path) => get(project, path) === undefined && get(global, path) !== undefined)
  if (inherited.length === 0) return "none"
  return inherited.length === configured.length ? "inherited" : "partial"
}

export function inheritedDescription(value: string, inheritance: IndexingInheritance) {
  if (inheritance === "inherited") return `${value} (inherited)`
  if (inheritance === "partial") return `${value} (partially inherited)`
  return value
}

function prune(input: unknown): unknown {
  if (!record(input)) return input
  const entries = Object.entries(input).flatMap(([key, value]) => {
    if (value === undefined) return []
    const next = prune(value)
    if (record(next) && Object.keys(next).length === 0) return []
    return [[key, next] as const]
  })
  return Object.fromEntries(entries)
}

function removed(before: unknown, after: unknown, prefix: string[]): string[][] {
  if (!record(before)) return []
  const next = record(after) ? after : {}
  return Object.entries(before).flatMap(([key, value]) => {
    const path = [...prefix, key]
    if (!(key in next)) return [path]
    if (record(value) && record(next[key])) return removed(value, next[key], path)
    return []
  })
}

export function indexingPatch(before: IndexingConfig, after: IndexingConfig) {
  const indexing = prune(after) as IndexingConfig
  const unset = removed(before, indexing, ["indexing"])
  return { indexing, unset: unset.length > 0 ? unset : undefined }
}

function mergeRecord(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (record(value) && record(result[key])) {
      result[key] = mergeRecord(result[key], value)
      continue
    }
    result[key] = value
  }
  return result
}

export function mergeIndexingConfig(base: IndexingConfig, patch: IndexingConfig): IndexingConfig {
  return mergeRecord(base, patch) as IndexingConfig
}

const OTHER_PROVIDERS = [
  "openai",
  "ollama",
  "openai-compatible",
  "gemini",
  "mistral",
  "vercel-ai-gateway",
  "bedrock",
  "openrouter",
  "voyage",
] as const

function configured(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === "string") return value.trim().length > 0
  if (typeof value === "object") return Object.values(value).some(configured)
  return true
}

export function shouldDefaultIndexingToKilo(indexing: IndexingConfig, kilo: boolean) {
  if (indexing.provider !== undefined || !kilo) return false
  return !OTHER_PROVIDERS.some((provider) => configured(indexing[provider]))
}

export function createIndexingDialogState(input: {
  scope: Accessor<IndexingScope>
  global: Accessor<IndexingConfig>
  project: Accessor<IndexingConfig>
  resolve: (indexing: IndexingConfig, global: IndexingConfig) => IndexingConfig
}) {
  const raw = createMemo(() => (input.scope() === "global" ? input.global() : input.project()))
  const config = createMemo(() => {
    const value = input.scope() === "global" ? raw() : mergeIndexingConfig(input.global(), raw())
    return input.resolve(value, input.global())
  })
  const enabled = createMemo(() => {
    if (input.scope() === "global") return raw().enabled === true
    return (raw().enabled ?? input.global().enabled) === true
  })
  const inherited = (paths: readonly (readonly string[])[]) =>
    indexingInheritance(input.scope(), input.global(), input.project(), paths)

  return { raw, config, enabled, inherited }
}
