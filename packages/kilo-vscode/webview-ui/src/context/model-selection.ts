import type { ModelSelection, Provider } from "../types/messages"
import { isModelValid } from "./provider-utils"

function validate(
  providers: Record<string, Provider>,
  connected: string[],
  selection: ModelSelection | null | undefined,
): ModelSelection | null {
  if (!selection) return null
  if (Object.keys(providers).length === 0) return selection
  return isModelValid(providers, connected, selection) ? selection : null
}

function recent(
  providers: Record<string, Provider>,
  connected: string[],
  selections: ModelSelection[] | undefined,
): ModelSelection | null {
  for (const item of selections ?? []) {
    const selection = validate(providers, connected, item)
    if (selection) return selection
  }
  return null
}

export function resolveModelSelection(input: {
  providers: Record<string, Provider>
  connected: string[]
  override?: ModelSelection | null
  mode?: ModelSelection | null
  global?: ModelSelection | null
  recent?: ModelSelection[]
  fallback?: ModelSelection | null
}): ModelSelection | null {
  const preferred =
    validate(input.providers, input.connected, input.override) ??
    validate(input.providers, input.connected, input.mode) ??
    validate(input.providers, input.connected, input.global) ??
    recent(input.providers, input.connected, input.recent) ??
    validate(input.providers, input.connected, input.fallback)
  if (preferred) return preferred
  if (!input.fallback) return null

  const efficient = validate(input.providers, input.connected, { providerID: "kilo", modelID: "kilo-auto/efficient" })
  if (efficient) return efficient

  for (const [providerID, provider] of Object.entries(input.providers)) {
    const modelID = Object.keys(provider.models).at(0)
    if (!modelID) continue
    const selection = validate(input.providers, input.connected, { providerID, modelID })
    if (selection) return selection
  }
  return null
}
