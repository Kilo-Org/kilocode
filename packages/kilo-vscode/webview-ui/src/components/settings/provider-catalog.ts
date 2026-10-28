// Main's provider catalog helpers for v2 integrations. v2 integrations carry no v1 provider `metadata` (priority,
// icon, noteKey), which v1 added on the server in packages/opencode/src/kilocode/provider/metadata.ts. That table is
// presentation only, so it is mirrored here.
import { iconNames, type IconName } from "@opencode-ai/ui/icons/provider"
import type { ConnectionInfo, IntegrationInfo } from "@opencode/client"

export const KILO_PROVIDER_ID = "kilo"

// main: packages/opencode/src/kilocode/provider/metadata.ts
const PROVIDER_PRIORITY = [
  KILO_PROVIDER_ID,
  "anthropic",
  "deepseek",
  "openai",
  "google",
  "anaconda-desktop",
  "openrouter",
  "vercel",
]
const NOTES: Record<string, string> = {
  kilo: "settings.providers.note.kilo",
  opencode: "settings.providers.note.opencode",
  anthropic: "settings.providers.note.anthropic",
  deepseek: "settings.providers.note.deepseek",
  "github-copilot": "settings.providers.note.copilot",
  openai: "settings.providers.note.openai",
  google: "settings.providers.note.google",
  openrouter: "settings.providers.note.openrouter",
  vercel: "settings.providers.note.vercel",
  "anaconda-desktop": "settings.providers.note.anacondaDesktop",
}

export function isPopularProvider(id: string) {
  return PROVIDER_PRIORITY.includes(id)
}

export function popularProviderIndex(id: string) {
  const index = PROVIDER_PRIORITY.indexOf(id.toLowerCase())
  return index >= 0 ? index : PROVIDER_PRIORITY.length
}

function validIcon(id: string | undefined): IconName | undefined {
  if (!id) return undefined
  if (iconNames.includes(id as IconName)) return id as IconName
  return undefined
}

export function providerIcon(id: string): IconName {
  if (id === KILO_PROVIDER_ID) return validIcon("kilo") ?? "synthetic"
  return validIcon(id) ?? "synthetic"
}

export function providerNoteKey(id: string): string | undefined {
  return NOTES[id.startsWith("github-copilot") ? "github-copilot" : id]
}

export function sortProviders<T extends { id: string; name: string }>(items: T[]) {
  return items.slice().sort((a, b) => {
    const rank = popularProviderIndex(a.id) - popularProviderIndex(b.id)
    if (rank !== 0) return rank
    return a.name.localeCompare(b.name)
  })
}

/** The stored credentials of an integration. Environment connections are not credentials. */
export function credentials(integration: IntegrationInfo) {
  return integration.connections.filter(
    (item): item is Extract<ConnectionInfo, { type: "credential" }> => item.type === "credential",
  )
}
