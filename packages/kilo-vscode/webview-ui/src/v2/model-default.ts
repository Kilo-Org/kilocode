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
 * A Kilo candidate is not trusted before the account is known, and the recents are not used before the preferences
 * arrive, so a dialog cannot open on the server default and then jump to the recent pick. Neither wait can block the
 * resolver: the server default is resolved for this scope and stands in while the account is unknown, and a team
 * account never reads the recents.
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
  const accountKnown = input.team !== undefined
  const inCatalog = (ref: Ref | undefined) => (ref && input.valid(ref) ? ref : undefined)
  // v1 `validate`: a Kilo model belongs to an account only once that account is known.
  const candidate = (ref: Ref | undefined) =>
    ref && (accountKnown || ref.providerID !== KILO) ? inCatalog(ref) : undefined
  const preference = candidate(input.pick) ?? candidate(input.agent) ?? candidate(input.configured)
  if (preference) return preference
  // v1 never used the recents for a team: its recommendation, else the first Kilo model.
  if (input.team)
    return inCatalog(input.serverDefault) ?? inCatalog(input.models.find((model) => model.providerID === KILO))
  // The account read can fail for good: `kilo-models.ts` keeps `ready` false after a rejected `authStatus`, and it
  // reads again only on a catalog change. The server default is resolved for this scope, so it fills the picker here
  // instead of leaving a dialog that can never submit.
  if (!accountKnown) return inCatalog(input.serverDefault)
  // A personal account's last tier is the recents, which are incomplete until the preferences arrive.
  if (!input.loaded) return undefined
  const recent = input.recents
    .map((item) => ({ providerID: item.providerID, id: item.modelID }))
    .find((item) => candidate(item))
  // v1 used its `KILO_AUTO` constant here; the free router is a catalog model now, and the server default is the v2
  // answer when that model is gone (a team-only catalog, a custom server).
  return recent ?? candidate(KILO_AUTO) ?? inCatalog(input.serverDefault)
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
