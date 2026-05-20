/**
 * token-est.ts — Character-based token count estimation
 * Ported from gemini-cli (Apache-2.0)
 * Deps: none
 *
 * ASCII ≈ 0.33 tokens/char, CJK ≈ 1.5 tokens/char
 */

const ASCII_TPC = 0.33
const CJK_TPC = 1.5
const MAX_FULL = 100_000
const DEFAULT_CPT = 4

export function estimateTokens(text: string, charsPerToken = DEFAULT_CPT): number {
  if (text.length > MAX_FULL) return Math.floor(text.length / charsPerToken)
  let tokens = 0
  const tpc = 1 / charsPerToken
  for (let i = 0; i < text.length; i++) {
    tokens += text.charCodeAt(i) <= 127 ? tpc : CJK_TPC
  }
  return Math.floor(tokens)
}

export interface ModelContext {
  name: string
  window: number
}

const KNOWN_MODELS: ModelContext[] = [
  { name: "claude-sonnet", window: 200_000 },
  { name: "claude-opus", window: 200_000 },
  { name: "claude-3.5", window: 200_000 },
  { name: "gpt-4o", window: 128_000 },
  { name: "gpt-4-turbo", window: 128_000 },
  { name: "gemini-2.5", window: 1_000_000 },
  { name: "gemini-3", window: 1_000_000 },
]

export function contextWindowForModel(model: string): number {
  const m = KNOWN_MODELS.find(k => model.includes(k.name))
  return m?.window ?? 200_000
}

export function contextPct(inputTokens: number, model: string): number {
  return Math.min(100, (inputTokens / contextWindowForModel(model)) * 100)
}
