import { localeToBcp47, type Locale } from "../context/language-utils"

/**
 * Wall-clock time for chat-line metadata in the user's timezone and the UI
 * language's conventions (12h or 24h). Same Intl call as the user-message
 * stamp in kilo-ui and the TUI session view.
 */
export function formatClock(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(localeToBcp47(locale), { timeStyle: "short" }).format(new Date(ms))
}

/** Compact duration for chat-line metadata, for example "45s", "2m 5s", "1h 3m". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
