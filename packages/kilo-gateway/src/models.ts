import { Effect, Schema } from "effect"
import type { KiloModels } from "@opencode-ai/schema/kilocode/models"
import type { GatewayAccount } from "./plugin.js"
import { fetchAuthenticatedJSON } from "./gateway.js"

// Source contract: origin/main ecccd1f, kilo-gateway/src/api/models.ts.
// Keep display metadata separate from model settings sent to inference providers.
const Response = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      preferredIndex: Schema.optionalKey(Schema.Finite),
      supported_parameters: Schema.optionalKey(Schema.Array(Schema.String)),
      autoRouting: Schema.optionalKey(Schema.Struct({ models: Schema.Array(Schema.String) })),
    }),
  ),
})

export function fetchModelMetadata(account: GatewayAccount) {
  const path =
    account.organizationID === null
      ? "/api/openrouter/models"
      : `/api/organizations/${encodeURIComponent(account.organizationID)}/models`
  return fetchAuthenticatedJSON(
    account.server,
    account.token,
    path,
    Response,
    account.organizationID ? { "X-KILOCODE-ORGANIZATIONID": account.organizationID } : {},
  ).pipe(
    Effect.map((response): KiloModels.Entry[] =>
      response.data
        .filter((model) => model.supported_parameters === undefined || model.supported_parameters.includes("tools"))
        .map((model) => ({
          id: model.id,
          ...(model.preferredIndex !== undefined ? { recommendedIndex: model.preferredIndex } : {}),
          ...(model.autoRouting ? { autoRouting: model.autoRouting } : {}),
        })),
    ),
  )
}
