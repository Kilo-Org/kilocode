export * as KiloSmallModel from "./small-model.js"

import { KiloDefaults } from "@kilocode/gateway-core"
import type { Model } from "@opencode/core/model"
import type { Provider } from "@opencode/schema/provider"
import { Effect } from "effect"

export const select = Effect.fn("KiloSmallModel.select")(function* (models: Model.Interface, providerID: Provider.ID) {
  const available = yield* models.available()
  if (
    !available.some((model) => model.providerID === providerID) ||
    ["azure", "azure-cognitive-services"].includes(providerID)
  )
    return
  const small = available.find(
    (model) => model.providerID === "kilo" && model.id === KiloDefaults.SMALL_MODEL && model.status === "active",
  )
  if (providerID === "kilo" && small) return small
  const native = yield* models.small(providerID)
  if (native) return native
  // Credential presence, not provider availability or token validation, gates main's cloud fallback.
  return small?.settings?.kiloCredentials === true ? small : undefined
})
