// The model of a new session, ported from v1 `resolveModelSelection` (context/model-selection.ts).
import type { ConfigEntry } from "@opencode/client"

type Ref = { providerID: string; id: string; variant?: string }

/**
 * The agent model, the configured `model`, the team default for a team account, the most recent pick that is still
 * in the catalog, then the server default. Each candidate must still be in the catalog (`valid`). While the account
 * is unknown (`team` undefined), the server default stands in, as v1 waited before it chose from the recents.
 */
export function initialModel(input: {
  agent: Ref | undefined
  configured: Ref | undefined
  team: boolean | undefined
  recents: readonly { providerID: string; modelID: string }[]
  valid: (ref: Ref) => boolean
  fallback: Ref | undefined
}): Ref | undefined {
  if (input.agent && input.valid(input.agent)) return input.agent
  if (input.configured && input.valid(input.configured)) return input.configured
  if (input.team !== false) return input.fallback
  const recent = input.recents
    .map((item) => ({ providerID: item.providerID, id: item.modelID }))
    .find((item) => input.valid(item))
  return recent ?? input.fallback
}

/** The `model` of the last config document that sets one, as the TUI reads it. */
export function configuredModel(entries: readonly ConfigEntry[] | undefined): Ref | undefined {
  const entry = entries?.findLast((item) => item.type === "document" && item.info.model !== undefined)
  const value = entry?.type === "document" ? entry.info.model : undefined
  if (typeof value === "object") return { providerID: value.providerID, id: value.model, variant: value.variant }
  const slash = value?.indexOf("/") ?? -1
  if (!value || slash <= 0) return undefined
  return { providerID: value.slice(0, slash), id: value.slice(slash + 1) }
}
