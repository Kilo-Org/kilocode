// kilocode_change - new file
import { isRecord } from "@/util/record"

export type TokenRates = {
  prompt?: number
  generation?: number
  source: "provider" | "computed"
}

export type ComputeInput = {
  providerMetadata?: unknown
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  elapsedMs: number
}

// kilocode_change start - tokens/second through-putation for #6579.
const safe = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return value
}

// llama.cpp surfaces timing under provider-specific metadata keys. We look at
// the most common shapes; providers without timing fields return undefined.
const providerRate = (metadata: unknown, key: string): number | undefined => {
  if (!isRecord(metadata)) return undefined
  for (const namespace of Object.values(metadata)) {
    if (!isRecord(namespace)) continue
    for (const [name, value] of Object.entries(namespace)) {
      if (name.toLowerCase() === key.toLowerCase()) {
        return safe(value)
      }
    }
  }
  return undefined
}

export function computeMetrics(input: ComputeInput): TokenRates | undefined {
  const providerPrompt = providerRate(input.providerMetadata, "prompt_per_second")
  const providerGeneration = providerRate(
    input.providerMetadata,
    "predicted_per_second",
  )

  if (providerPrompt !== undefined || providerGeneration !== undefined) {
    const result: TokenRates = { source: "provider" }
    if (providerPrompt !== undefined) result.prompt = providerPrompt
    if (providerGeneration !== undefined) result.generation = providerGeneration
    return result
  }

  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs <= 0) return undefined

  const generated = input.tokens.output + input.tokens.reasoning
  if (generated <= 0) return undefined

  const generation = (generated * 1000) / input.elapsedMs
  if (!Number.isFinite(generation) || generation <= 0) return undefined

  return { generation, source: "computed" }
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

export function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 t/s"
  return `${numberFormat.format(value)} t/s`
}
// kilocode_change end
