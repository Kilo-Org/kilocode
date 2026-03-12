import { iconNames, type IconName } from "@opencode-ai/ui/icons/provider"
import type { Provider } from "../../types/messages"

export const CUSTOM_PROVIDER_ID = "_custom"

export const POPULAR_PROVIDER_IDS = [
  "kilo",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
] as const

const POPULAR_PROVIDER_SET = new Set<string>(POPULAR_PROVIDER_IDS)

export function isPopularProvider(providerID: string) {
  return POPULAR_PROVIDER_SET.has(providerID)
}

export function popularProviderIndex(providerID: string) {
  const index = POPULAR_PROVIDER_IDS.indexOf(providerID as (typeof POPULAR_PROVIDER_IDS)[number])
  return index >= 0 ? index : POPULAR_PROVIDER_IDS.length
}

export function providerIcon(providerID: string): IconName {
  if (providerID === "kilo") return "synthetic"
  if (iconNames.includes(providerID as IconName)) return providerID as IconName
  return "synthetic"
}

export function providerNoteKey(providerID: string) {
  if (providerID === "kilo") return "dialog.provider.kilo.note"
  if (providerID === "opencode") return "dialog.provider.opencode.note"
  if (providerID === "anthropic") return "dialog.provider.anthropic.note"
  if (providerID.startsWith("github-copilot")) return "dialog.provider.copilot.note"
  if (providerID === "openai") return "dialog.provider.openai.note"
  if (providerID === "google") return "dialog.provider.google.note"
  if (providerID === "openrouter") return "dialog.provider.openrouter.note"
  if (providerID === "vercel") return "dialog.provider.vercel.note"
  return undefined
}

export function sortProviders(items: Provider[]) {
  return items.slice().sort((a, b) => {
    const rank = popularProviderIndex(a.id) - popularProviderIndex(b.id)
    if (rank !== 0) return rank
    return a.name.localeCompare(b.name)
  })
}
