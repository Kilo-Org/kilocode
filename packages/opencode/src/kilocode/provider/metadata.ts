import { iconNames, type IconName } from "@opencode-ai/ui/icons/provider"

export type ProviderMetadata = {
  noteKey?: string
  icon?: string
  priority?: number
}

const notes: Record<string, string> = {
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

const order = ["kilo", "anthropic", "deepseek", "openai", "google", "anaconda-desktop", "openrouter", "vercel"] as const

const priority = new Map<string, number>(order.map((id, index) => [id, index]))

const icons = new Set<string>(iconNames)

// kilocode_change - providers that should reuse another provider's icon.
// Tencent TokenPlan shares the Tencent TokenHub icon.
const iconAliases: Record<string, string> = {
  "tencent-tokenplan": "tencent-tokenhub",
}

function key(id: string) {
  if (id.startsWith("github-copilot")) return "github-copilot"
  return id
}

function resolveIcon(name: string): string {
  const alias = iconAliases[name] // kilocode_change
  if (alias && icons.has(alias as IconName)) return alias // kilocode_change
  return icons.has(name as IconName) ? name : "synthetic"
}

export function providerMetadata(id: string): ProviderMetadata {
  const name = key(id)
  const note = notes[name]
  return {
    noteKey: note,
    icon: resolveIcon(name), // kilocode_change
    priority: priority.get(name),
  }
}
