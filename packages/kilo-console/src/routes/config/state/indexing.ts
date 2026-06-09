import type { IndexingConfig } from "@kilocode/sdk/v2/client"

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

export function clone(input: IndexingConfig | undefined): IndexingConfig {
  return structuredClone(input ?? {})
}

export function shouldSync(selected: string, current: string, dirty: boolean, source: string, next: string) {
  return selected !== current || (!dirty && source !== next)
}

export function merge(base: IndexingConfig | undefined, patch: IndexingConfig | undefined): IndexingConfig {
  const result: Record<string, unknown> = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (record(value) && record(result[key])) {
      result[key] = { ...result[key], ...value }
      continue
    }
    result[key] = value
  }
  return result as IndexingConfig
}

function prune(input: unknown): unknown {
  if (typeof input === "string") return input.trim() || undefined
  if (!record(input)) return input ?? undefined
  const entries = Object.entries(input).flatMap(([key, value]) => {
    const next = prune(value)
    return next === undefined ? [] : [[key, next] as const]
  })
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

export function clean(input: IndexingConfig): IndexingConfig {
  return (prune(input) ?? {}) as IndexingConfig
}

export function providerPatch(provider: IndexingConfig["provider"] | "", model?: string): IndexingConfig {
  return {
    provider: provider || undefined,
    model: provider === "kilo" ? model || undefined : undefined,
    dimension: undefined,
  }
}

function paths(before: unknown, after: unknown, prefix: string[]): string[][] {
  if (!record(before)) return []
  const next = record(after) ? after : {}
  return Object.entries(before).flatMap(([key, value]) => {
    const path = [...prefix, key]
    if (!(key in next)) return [path]
    if (record(value) && record(next[key])) return paths(value, next[key], path)
    return []
  })
}

export function removed(before: IndexingConfig, after: IndexingConfig): string[][] {
  return paths(before, after, ["indexing"])
}

export function validate(input: IndexingConfig): string[] {
  const errors: string[] = []
  if (input.dimension !== undefined && input.dimension !== null) {
    if (!Number.isInteger(input.dimension) || input.dimension <= 0)
      errors.push("Vector dimension must be a positive integer.")
  }
  if (input.searchMinScore !== undefined && (input.searchMinScore < 0 || input.searchMinScore > 1)) {
    errors.push("Search minimum score must be between 0 and 1.")
  }
  const integers = [
    ["Search maximum results", input.searchMaxResults],
    ["Embedding batch size", input.embeddingBatchSize],
    ["Scanner maximum retries", input.scannerMaxBatchRetries],
  ] as const
  for (const [label, value] of integers) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0))
      errors.push(`${label} must be a positive integer.`)
  }
  return errors
}
