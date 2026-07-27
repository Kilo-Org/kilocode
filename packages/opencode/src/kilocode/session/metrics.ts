// kilocode_change - new file
// Wire shape mirrors the SDK schema (packages/sdk/js/src/v2/gen/types.gen.ts
// StepFinishPart.metrics). `source` stays on the wire for backward
// compatibility with downstream consumers — see packages/kilo-vscode/
// webview-ui/src/context/session-utils.ts and AssistantMessage.tsx —
// but only the "computed" literal is reachable here because llama.cpp's
// `prompt_per_second` / `predicted_per_second` are dropped upstream by
// `@ai-sdk/openai-compatible` before the raw usage reaches our adapter.
// Follow-up: wire `metadataExtractor` into the shared
// `createOpenAICompatible` call so the provider source is reachable again.
export type TokenRates = {
  prompt?: number
  generation?: number
  source: "computed"
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

// kilocode_change start - tokens/second throughput for #6579.
export function computeMetrics(input: ComputeInput): TokenRates | undefined {
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
