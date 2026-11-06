// The Kilo Gateway model metadata that the v2 model catalog does not carry: the recommended order, free, BYOK and
// prompt training flags, auto routing, Terminal Bench and the description. The `kilocode.gateway` `models` RPC
// returns it, as the TUI model picker reads it. The team of the account comes with it, because v1 prefers the team
// default model over the recent picks.
import type { ModelInfo, OpenCodeClient } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createEffect, createSignal, on, type Accessor, type Setter } from "solid-js"

export type KiloModelEntry = KiloGatewayRpc.ModelEntry

export type KiloModels = {
  entries: ReadonlyMap<string, KiloModelEntry>
  /** The selected team, `null` for the personal account, undefined while unknown or signed out. */
  organizationID: string | null | undefined
  /** Whether the first read finished, so `organizationID` is known. */
  ready: boolean
}

const EMPTY: KiloModels = { entries: new Map(), organizationID: undefined, ready: false }

/** The metadata of one server connection, shared by every directory store that reads it. */
export type KiloModelsCache = {
  readonly value: Accessor<KiloModels>
  readonly set: Setter<KiloModels>
  readonly state: { read: number; source?: readonly ModelInfo[] }
}

export function createKiloModelsCache(): KiloModelsCache {
  const [value, set] = createSignal(EMPTY)
  return { value, set, state: { read: 0 } }
}

/** Whether a new session takes the team default: undefined until the account is known. */
export function kiloTeam(value: KiloModels) {
  if (!value.ready) return undefined
  return !!value.organizationID
}

/**
 * Reads the metadata again each time the model list changes, for example after a sign-in or a team switch. Only the
 * latest read writes. Without the RPC (cold or failed catalog) the pickers show the models without Gateway data. A
 * list without Kilo models (the catalog reloads during a team switch) keeps the last value, so the team default of a
 * new session does not change to a recent pick for that moment.
 */
export function createKiloModels(input: {
  api: OpenCodeClient
  directory: string
  models: Accessor<ModelInfo[] | undefined>
  /** Shared per connection by the Agent Manager; a store created alone keeps its own copy. */
  cache?: KiloModelsCache
}): Accessor<KiloModels> {
  const rpc = input.api.rpc(KiloGatewayRpc.Definition)
  const location = { location: { directory: input.directory } }
  const cache = input.cache ?? createKiloModelsCache()
  createEffect(
    on(input.models, (models) => {
      if (!models) return
      // One connection reads once per model list value. A different array means a catalog reload, for example after
      // a sign-in or a team switch, and reads again.
      if (cache.state.source === models) return
      cache.state.source = models
      const read = ++cache.state.read
      // Without Kilo models there is no team default to prefer (the server default is not a team model), so the
      // recents may win. A team switch reload keeps the team it had before.
      if (!models.some((model) => model.providerID === "kilo")) return cache.set((prev) => ({ ...prev, ready: true }))
      void Promise.all([
        rpc.models({}, location).catch(() => []),
        rpc.authStatus({}, location).catch(() => undefined),
      ]).then(([entries, auth]) => {
        if (read !== cache.state.read) return
        // A failed account read keeps the account unknown (or the team known before), so a recent pick cannot
        // replace the team default of a team account.
        cache.set((prev) => ({
          entries: new Map(entries.map((entry) => [entry.id, entry])),
          organizationID: auth ? (auth.authenticated ? auth.organizationID : undefined) : prev.organizationID,
          ready: auth ? true : prev.ready,
        }))
      })
    }),
  )
  return cache.value
}
