import type { ModelSelection } from "../types/messages"

/**
 * Variant (thinking effort) key construction and lookup.
 *
 * Variants are persisted per (mode, model) pair so that two modes using
 * the same model can keep independent thinking levels. The compound key
 * `${agent}:${providerID}/${modelID}` separates the mode dimension from
 * the model identifier with a colon so legacy single-model keys remain
 * distinguishable for read fallback.
 */

export function variantKey(agent: string, sel: ModelSelection): string {
  return `${agent}:${sel.providerID}/${sel.modelID}`
}

export function legacyVariantKey(sel: ModelSelection): string {
  return `${sel.providerID}/${sel.modelID}`
}

/**
 * Look up the stored variant for (agent, model). Falls back to the
 * legacy single-model key so users carrying pre-fix entries keep their
 * last-chosen variant on first read; subsequent writes upgrade to the
 * compound key.
 */
export function getStoredVariant(
  variants: Record<string, string>,
  agent: string,
  sel: ModelSelection,
): string | undefined {
  return variants[variantKey(agent, sel)] ?? variants[legacyVariantKey(sel)]
}
