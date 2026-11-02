// The `kilo-code.v2.settings` command takes its target as command arguments, so a caller can open a tab from a
// keybinding, another extension, or a webview message. A bare string is the tab id, as v1 accepted; an object may also
// carry a subtab, a row focus, an i18n title key, or a request to focus the search field.
import type { SettingsNavigation } from "./protocol"

export function parseSettingsTarget(args: unknown[]): SettingsNavigation {
  const [first] = args
  const tab = text(first)
  if (tab) return { tab }
  if (!first || typeof first !== "object" || Array.isArray(first)) return {}
  const value = first as Record<string, unknown>
  const target: SettingsNavigation = {}
  const key = text(value.tab)
  if (key) target.tab = key
  const subtab = text(value.subtab)
  if (subtab) target.subtab = subtab
  const focus = text(value.focus)
  if (focus) target.focus = focus
  const titleKey = text(value.titleKey)
  if (titleKey) target.titleKey = titleKey
  if (value.search === true) target.search = true
  return target
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
