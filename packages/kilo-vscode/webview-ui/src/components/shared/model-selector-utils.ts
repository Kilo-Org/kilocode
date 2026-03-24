import type { ModelSelection } from "../../types/messages"
import type { EnrichedModel } from "../../context/provider"
import {
  KILO_PROVIDER_ID as KILO_GATEWAY_ID,
  PROVIDER_PRIORITY as PROVIDER_ORDER,
  providerOrderIndex,
} from "../../../../src/shared/provider-model"

export { KILO_GATEWAY_ID, PROVIDER_ORDER }

export const KILO_AUTO_SMALL_IDS = new Set(["kilo-auto/small", "auto-small"])

export function isSmall(model: Pick<EnrichedModel, "providerID" | "id">): boolean {
  return model.providerID === KILO_GATEWAY_ID && KILO_AUTO_SMALL_IDS.has(model.id)
}

export function providerSortKey(providerID: string, order: readonly string[] = PROVIDER_ORDER): number {
  return providerOrderIndex(providerID, order as typeof PROVIDER_ORDER)
}

export function isFree(model: Pick<EnrichedModel, "isFree">): boolean {
  return model.isFree === true
}

// Strips trailing free-indicator suffixes from model display names, e.g.
// "Llama 3 (free)" → "Llama 3", "Mixtral free" → "Mixtral"
export function sanitizeName(name: string): string {
  return name
    .replace(/[\s:_-]*\(free\)\s*$/i, "")
    .replace(/[\s:_-]+free\s*$/i, "")
    .trim()
}

export function stripSubProviderPrefix(name: string): string {
  const colon = name.indexOf(": ")
  if (colon < 0) return name
  const prefix = name.slice(0, colon)
  if (prefix.toLowerCase() === KILO_GATEWAY_ID) return name
  return name.slice(colon + 2)
}

export function buildTriggerLabel(
  resolvedName: string | undefined,
  providerID: string | undefined,
  providerName: string | undefined,
  raw: ModelSelection | null,
  allowClear: boolean,
  clearLabel: string,
  hasProviders: boolean,
  labels: { select: string; noProviders: string; notSet: string },
): string {
  if (resolvedName) {
    if (providerID === KILO_GATEWAY_ID) return stripSubProviderPrefix(resolvedName)
    if (providerName) return `${providerName} / ${resolvedName}`
    return resolvedName
  }
  if (raw?.providerID && raw?.modelID) {
    return raw.providerID === KILO_GATEWAY_ID ? raw.modelID : `${raw.providerID} / ${raw.modelID}`
  }
  if (allowClear) return clearLabel || labels.notSet
  return hasProviders ? labels.select : labels.noProviders
}
