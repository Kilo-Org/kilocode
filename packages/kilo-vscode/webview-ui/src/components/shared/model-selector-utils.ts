import type { ModelSelection } from "../../types/messages"
import type { EnrichedModel } from "../../context/provider"

export const KILO_GATEWAY_ID = "kilo"

export const PROVIDER_ORDER = [KILO_GATEWAY_ID, "anthropic", "openai", "google"]

export function providerSortKey(providerID: string, order = PROVIDER_ORDER): number {
  const idx = order.indexOf(providerID.toLowerCase())
  return idx >= 0 ? idx : order.length
}

export function isFree(model: Pick<EnrichedModel, "inputPrice">): boolean {
  return model.inputPrice === 0
}

export function buildTriggerLabel(
  resolvedName: string | undefined,
  raw: ModelSelection | null,
  allowClear: boolean,
  clearLabel: string,
  hasProviders: boolean,
  labels: { select: string; noProviders: string; notSet: string },
): string {
  if (resolvedName) return resolvedName
  if (raw?.providerID && raw?.modelID) {
    return raw.providerID === KILO_GATEWAY_ID ? raw.modelID : `${raw.providerID} / ${raw.modelID}`
  }
  if (allowClear) return clearLabel || labels.notSet
  return hasProviders ? labels.select : labels.noProviders
}
