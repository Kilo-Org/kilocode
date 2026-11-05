// The Kilo Gateway model metadata that the v2 model catalog does not carry: the recommended order, free, BYOK and
// prompt training flags, auto routing, Terminal Bench and the description. The `kilocode.gateway` `models` RPC
// returns it, as the TUI model picker reads it. The team of the account comes with it, because v1 prefers the team
// default model over the recent picks.
import type { ModelInfo, OpenCodeClient } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createEffect, createSignal, on, type Accessor } from "solid-js"

export type KiloModelEntry = KiloGatewayRpc.ModelEntry

export type KiloModels = {
  entries: ReadonlyMap<string, KiloModelEntry>
  /** The selected team, `null` for the personal account, undefined while unknown or signed out. */
  organizationID: string | null | undefined
  /** Whether the first read finished, so `organizationID` is known. */
  ready: boolean
}

const EMPTY: KiloModels = { entries: new Map(), organizationID: undefined, ready: false }

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
}): Accessor<KiloModels> {
  const rpc = input.api.rpc(KiloGatewayRpc.Definition)
  const location = { location: { directory: input.directory } }
  const [value, setValue] = createSignal(EMPTY)
  const state = { read: 0 }
  createEffect(
    on(input.models, (models) => {
      const read = ++state.read
      if (!models) return
      if (!models.some((model) => model.providerID === "kilo")) return setValue((prev) => ({ ...prev, ready: true }))
      void Promise.all([
        rpc.models({}, location).catch(() => []),
        rpc.authStatus({}, location).catch(() => undefined),
      ]).then(([entries, auth]) => {
        if (read !== state.read) return
        setValue({
          entries: new Map(entries.map((entry) => [entry.id, entry])),
          organizationID: auth?.authenticated ? auth.organizationID : undefined,
          ready: true,
        })
      })
    }),
  )
  return value
}
