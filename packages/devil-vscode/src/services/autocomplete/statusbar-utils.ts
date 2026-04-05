import { t } from "./shims/i18n"

/**
 * Format a session cost value to a human-readable string.
 * - $0 → translated zero string
 * - $0.001 → translated "less than a cent"
 * - $0.12 → "$0.12"
 */
export function humanFormatSessionCost(cost: number): string {
  if (cost === 0) {
    return t("kilocode:autocomplete.statusBar.cost.zero")
  }
  if (cost > 0 && cost < 0.01) {
    return t("kilocode:autocomplete.statusBar.cost.lessThanCent")
  }
  return `$${cost.toFixed(2)}`
}

/**
 * Format a Unix timestamp (ms) as a locale time string.
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}
