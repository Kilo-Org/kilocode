import { iconNames, type IconName } from "@opencode-ai/ui/icons/provider"
import type { Provider } from "../../types/messages"
import {
  KILO_PROVIDER_ID,
  PROVIDER_PRIORITY as FALLBACK_PROVIDER_IDS,
  createKiloFallbackProvider,
  providerOrderIndex,
} from "../../../../src/shared/provider-model"

export const CUSTOM_PROVIDER_ID = "_custom"

const fallback = new Set<string>(FALLBACK_PROVIDER_IDS)

export function isPopularProvider(provider: Provider | string) {
  const id = typeof provider === "string" ? provider : provider.id
  if (typeof provider !== "string" && provider.metadata?.priority !== undefined) return true
  return fallback.has(id)
}

export function popularProviderIndex(provider: Provider | string) {
  const id = typeof provider === "string" ? provider : provider.id
  if (typeof provider !== "string" && provider.metadata?.priority !== undefined) return provider.metadata.priority
  return providerOrderIndex(id, FALLBACK_PROVIDER_IDS)
}

function validIcon(id: string | undefined): IconName | undefined {
  if (!id) return undefined
  if (iconNames.includes(id as IconName)) return id as IconName
  return undefined
}

export function providerIcon(provider: Provider | string): IconName {
  const providerID = typeof provider === "string" ? provider : provider.id
  const icon = typeof provider === "string" ? undefined : validIcon(provider.metadata?.icon)
  if (icon) return icon
  if (providerID === KILO_PROVIDER_ID) return validIcon("kilo") ?? "synthetic"
  const fallback = validIcon(providerID)
  if (fallback) return fallback
  return "synthetic"
}

export function kiloFallbackProvider(): Provider {
  return createKiloFallbackProvider()
}

export function providerNoteKey(provider: Provider | string) {
  if (typeof provider !== "string" && provider.metadata?.noteKey) return provider.metadata.noteKey
  if (provider === KILO_PROVIDER_ID) return "settings.providers.note.kilo"
  return undefined
}

export function sortProviders(items: Provider[]) {
  return items.slice().sort((a, b) => {
    const rank = popularProviderIndex(a) - popularProviderIndex(b)
    if (rank !== 0) return rank
    return a.name.localeCompare(b.name)
  })
}
