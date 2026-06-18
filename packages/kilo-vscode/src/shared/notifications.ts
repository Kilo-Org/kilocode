import type { KilocodeNotification } from "@kilocode/kilo-gateway"

export const BUILTIN_NOTIFICATIONS: KilocodeNotification[] = [
  {
    id: "star-giveaway-june-2026",
    title: "GitHub Star Giveaway",
    message: "We're giving away $500 of AI Credits when we reach 25,000 stars on GitHub. Support us:",
    action: { actionText: "github.com/Kilo-Org/kilocode", actionURL: "https://github.com/Kilo-Org/kilocode/" },
  },
]

export function pruneDismissals(
  notifications: readonly KilocodeNotification[],
  dismissed: readonly string[],
): string[] {
  if (notifications.length === 0) return [...dismissed]
  const active = new Set([...BUILTIN_NOTIFICATIONS, ...notifications].map((notification) => notification.id))
  return dismissed.filter((id) => active.has(id))
}

export function mergeDismissals(dismissed: readonly string[], local: ReadonlySet<string>): string[] {
  return Array.from(new Set([...dismissed, ...local]))
}
