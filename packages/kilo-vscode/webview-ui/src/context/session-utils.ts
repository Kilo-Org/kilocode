import type { Part } from "../types/messages"

/**
 * Derive a human-readable status string from the last streaming part.
 * Returns undefined for part types that don't map to a status.
 */
export function computeStatus(
  part: Part | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | undefined {
  if (!part) return undefined
  if (part.type === "tool") {
    switch (part.tool) {
      case "task":
        return t("ui.sessionTurn.status.delegating")
      case "todowrite":
      case "todoread":
        return t("ui.sessionTurn.status.planning")
      case "read":
        return t("ui.sessionTurn.status.gatheringContext")
      case "list":
      case "grep":
      case "glob":
        return t("ui.sessionTurn.status.searchingCodebase")
      case "webfetch":
        return t("ui.sessionTurn.status.searchingWeb")
      case "edit":
      case "write":
        return t("ui.sessionTurn.status.makingEdits")
      case "bash":
        return t("ui.sessionTurn.status.runningCommands")
      default:
        return undefined
    }
  }
  if (part.type === "reasoning") return t("ui.sessionTurn.status.thinking")
  if (part.type === "text") return t("session.status.writingResponse")
  return undefined
}

/**
 * Calculate total cost across all assistant messages.
 */
export function calcTotalCost(messages: Array<{ role: string; cost?: number }>): number {
  return messages.reduce((sum, m) => sum + (m.role === "assistant" ? (m.cost ?? 0) : 0), 0)
}

/**
 * Calculate total energy (Wh) across all assistant messages.
 */
export function calcTotalEnergy(messages: Array<{ role: string; energy?: { wh?: number } }>): number {
  return messages.reduce((sum, m) => sum + (m.role === "assistant" ? (m.energy?.wh ?? 0) : 0), 0)
}

/**
 * Format a watt-hour value with the appropriate metric prefix.
 */
export function formatWh(wh: number): string {
  if (!Number.isFinite(wh) || wh < 0) return "\u2014"
  if (wh === 0) return "0 Wh"
  if (wh >= 1000) return (wh / 1000).toFixed(2) + " kWh"
  if (wh >= 1) return wh.toFixed(2) + " Wh"
  if (wh >= 0.001) return (wh * 1000).toFixed(1) + " mWh"
  return (wh * 1_000_000).toFixed(1) + " μWh"
}

/**
 * Calculate context usage percentage given token counts and a context limit.
 */
export function calcContextUsage(
  tokens: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  },
  contextLimit: number | undefined,
): { tokens: number; percentage: number | null } {
  const total =
    tokens.input + tokens.output + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
  const percentage = contextLimit ? Math.round((total / contextLimit) * 100) : null
  return { tokens: total, percentage }
}
