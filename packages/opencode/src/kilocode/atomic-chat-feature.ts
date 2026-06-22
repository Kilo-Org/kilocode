import { ATOMIC_CHAT_PLUGIN } from "@kilocode/plugin-atomic-chat"
import { parsePluginSpecifier } from "@/plugin/shared"

type PluginSpec = string | [string, Record<string, unknown>]

export function isAtomicChatPlugin(item: PluginSpec): boolean {
  const spec = typeof item === "string" ? item : item[0]
  const parsed = parsePluginSpecifier(spec)
  if (!parsed.version.startsWith("npm:")) return parsed.pkg === ATOMIC_CHAT_PLUGIN
  if (!parsed.version.startsWith(`npm:${ATOMIC_CHAT_PLUGIN}`)) return false
  const version = parsed.version.slice(`npm:${ATOMIC_CHAT_PLUGIN}`.length)
  return version === "" || version.startsWith("@")
}

export function hasAtomicChatPlugin(plugins: readonly PluginSpec[]): boolean {
  return plugins.some(isAtomicChatPlugin)
}

export function ensureAtomicChatPlugin(items: readonly PluginSpec[]): PluginSpec[] {
  const plugins = [...items]
  if (hasAtomicChatPlugin(plugins)) return plugins
  return [...plugins, ATOMIC_CHAT_PLUGIN]
}
