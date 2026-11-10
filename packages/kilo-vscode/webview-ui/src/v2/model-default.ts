// The model of a new session, ported from v1 `resolveModelSelection` (context/model-selection.ts).
import type { ConfigEntry } from "@opencode/client"

type Ref = { providerID: string; id: string; variant?: string }

const KILO = "kilo"
// v1 `KILO_AUTO` (`shared/provider-model.ts`): the free router a personal account falls back to. It is a Gateway
// catalog model, so the fallback stands only while the catalog still lists it, then the server default stands in.
const KILO_AUTO: Ref = { providerID: KILO, id: "kilo-auto/free" }

/**
 * The explicit pick in this scope for this agent, the agent model, the configured `model`, the team default for a
 * team account, the most recent pick that is still in the catalog, then Kilo Auto Free (the server default when the
 * catalog no longer has it). Each candidate must still be in the catalog (`valid`).
 *
 * Nothing is chosen before the account and the recents are known (`loaded`): v1 returned no model while the provider
 * catalog was pending. Without that wait a dialog opens on the server default and then jumps to the recent pick, so
 * each open can settle on a different model.
 */
export function initialModel(input: {
  /** v1 `Pick(scope, agent)`: a pick in this composer or dialog sticks for the next new session of that agent. */
  pick?: Ref | undefined
  agent: Ref | undefined
  configured: Ref | undefined
  /** The selected team of the account; undefined while it is unknown, false for Personal or a signed-out client. */
  team: boolean | undefined
  /** Whether the model preferences arrived, so the recents are complete. */
  loaded: boolean
  recents: readonly { providerID: string; modelID: string }[]
  /** The catalog, for the first Kilo model a team account falls back to. */
  models: readonly { providerID: string; id: string }[]
  /** The server default of the directory: the team recommendation, or the best available model. */
  serverDefault: Ref | undefined
  valid: (ref: Ref) => boolean
}): Ref | undefined {
  const pending = input.team === undefined || !input.loaded
  // v1 `validate`: a Kilo model belongs to an account only once that account is known.
  const validate = (ref: Ref | undefined) => {
    if (!ref || (pending && ref.providerID === KILO)) return undefined
    return input.valid(ref) ? ref : undefined
  }
  const preference = validate(input.pick) ?? validate(input.agent) ?? validate(input.configured)
  if (preference) return preference
  if (pending) return undefined
  // v1 never used the recents or the fallback for a team: its recommendation, else the first Kilo model.
  if (input.team)
    return validate(input.serverDefault) ?? validate(input.models.find((model) => model.providerID === KILO))
  const recent = input.recents
    .map((item) => ({ providerID: item.providerID, id: item.modelID }))
    .find((item) => validate(item))
  // v1 used its `KILO_AUTO` constant here; the free router is a catalog model now, and the server default is the v2
  // answer when that model is gone (a team-only catalog, a custom server).
  return recent ?? validate(KILO_AUTO) ?? validate(input.serverDefault)
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
