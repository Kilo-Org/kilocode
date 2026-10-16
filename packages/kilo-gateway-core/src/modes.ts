export * as KiloModes from "./modes.js"

import { Effect, Option, Schema } from "effect"
import { KiloHeaders } from "./headers.js"
import { json, request } from "./http.js"
import { KiloServer } from "./server.js"

const TTL_MS = 5 * 60 * 1000

const EditGroupConfig = Schema.Struct({
  fileRegex: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
})

const GroupEntry = Schema.Union([Schema.String, Schema.Tuple([Schema.String, EditGroupConfig])])

const ModeConfig = Schema.Struct({
  roleDefinition: Schema.optionalKey(Schema.String),
  whenToUse: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  customInstructions: Schema.optionalKey(Schema.String),
  groups: Schema.optionalKey(Schema.Array(GroupEntry)),
})

export const OrganizationModeSchema = Schema.Struct({
  id: Schema.String,
  organization_id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  created_by: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  config: ModeConfig,
})

export type OrganizationMode = typeof OrganizationModeSchema.Type

const Response = Schema.Struct({
  modes: Schema.Array(OrganizationModeSchema),
})
const decode = Schema.decodeUnknownOption(Response)

const cache = new Map<string, { readonly modes: readonly OrganizationMode[]; readonly timestamp: number }>()

export function clearCache() {
  cache.clear()
}

// Ported from v1 `fetchOrganizationModes` (`api/modes.ts:62-97`):
// fetches `/api/organizations/{id}/modes` with a 5-minute per-organization cache.
export function get(
  server: string,
  token: string,
  organizationID: string,
  version = "unknown",
): Effect.Effect<readonly OrganizationMode[]> {
  return Effect.gen(function* () {
    const key = `${KiloServer.normalize(server)}:${organizationID}`
    const cached = cache.get(key)
    if (cached && Date.now() - cached.timestamp < TTL_MS) return cached.modes

    const response = yield* request(
      `${KiloServer.normalize(server)}/api/organizations/${encodeURIComponent(organizationID)}/modes`,
      {
        headers: {
          ...KiloHeaders.provider({ version, organizationID }),
          Authorization: `Bearer ${token}`,
        },
      },
      "Organization modes fetch failed",
    )
    if (!response.ok) return []
    const parsed = decode(yield* json(response, "Organization modes fetch failed"))
    if (Option.isNone(parsed)) return []
    cache.set(key, { modes: parsed.value.modes, timestamp: Date.now() })
    return parsed.value.modes
  }).pipe(Effect.orElseSucceed(() => []))
}
