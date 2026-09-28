import type { ProviderAuthState } from "../../types/messages"
import type { Provider, ProviderConfig } from "../../types/messages"
import type { ProviderAuthMethod } from "@kilocode/sdk/v2/client"
import {
  KILO_PROVIDER_ID,
  createKiloFallbackProvider,
  isCustomProviderPackage,
} from "../../../../src/shared/provider-model"
import { isLocalProviderOptionalApiKey } from "../../utils/local-providers"

export function canChangeProviderKey(
  item: Provider,
  cfg: ProviderConfig | undefined,
  methods: ProviderAuthMethod[] | undefined,
) {
  if (item.source !== "api" && item.source !== "config") return false
  // Config keys override the stored key written by the connection dialog.
  if (cfg?.options?.apiKey != null || cfg?.api_key != null) return false
  if (isCustomProviderPackage(cfg?.npm) || isLocalProviderOptionalApiKey(item.id)) return false
  if (
    [
      KILO_PROVIDER_ID,
      "anaconda-desktop",
      "ollama",
      "amazon-bedrock",
      "google-vertex",
      "google-vertex-anthropic",
    ].includes(item.id)
  )
    return false
  // Only offer key replacement when the dialog opens a standard API-key form.
  return (
    methods === undefined || (methods.length === 1 && methods.at(0)?.type === "api" && !methods.at(0)?.prompts?.length)
  )
}

export function visibleConnectedIds(connected: string[], authStates: Record<string, ProviderAuthState>) {
  return connected.filter((id) => id !== KILO_PROVIDER_ID || authStates[KILO_PROVIDER_ID] !== undefined)
}

export function disabledProviderOptions(providers: Record<string, Provider>, disabled: string[]) {
  const current = new Set(disabled)
  return Object.values(providers)
    .filter((item) => !current.has(item.id))
    .map((item) => ({ value: item.id, label: item.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function providersWithKiloFallback(providers: Record<string, Provider>): Record<string, Provider> {
  if (providers[KILO_PROVIDER_ID]) return providers
  return { [KILO_PROVIDER_ID]: createKiloFallbackProvider(), ...providers }
}
