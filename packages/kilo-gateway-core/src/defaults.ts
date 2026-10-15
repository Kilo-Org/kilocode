export * as KiloDefaults from "./defaults.js"

import { Effect, Option, Schema } from "effect"
import { json, request } from "./http.js"
import { KiloServer } from "./server.js"

export const DEFAULT_MODEL = "kilo-auto/frontier"
export const DEFAULT_FREE_MODEL = "kilo-auto/free"
export const SMALL_MODEL = "kilo-auto/small"

const Response = Schema.Struct({
  defaultModel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  defaultFreeModel: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
const decode = Schema.decodeUnknownOption(Response)

export interface Scope {
  readonly server: string
  readonly token?: string
  readonly organizationID?: string | null
  readonly fallback?: string
}

// Same behavior as v1 `fetchDefaultModel` (`api/profile.ts:106-136`):
// reads `/api/organizations/{id}/defaults` for a team or `/api/defaults` otherwise,
// and falls back to `scope.fallback` (first model in catalog for a team) or
// `kilo-auto/frontier` when signed in / `kilo-auto/free` when signed out.
export function get(scope: Scope): Effect.Effect<string> {
  const fallback = scope.fallback
    ? stripProviderPrefix(scope.fallback)
    : scope.token
      ? DEFAULT_MODEL
      : DEFAULT_FREE_MODEL
  return Effect.gen(function* () {
    const server = KiloServer.normalize(scope.server)
    const organizationID = scope.token ? (scope.organizationID ?? null) : null
    const path = organizationID
      ? `/api/organizations/${encodeURIComponent(organizationID)}/defaults`
      : "/api/defaults"
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(scope.token ? { Authorization: `Bearer ${scope.token}` } : {}),
    }
    const response = yield* request(`${server}${path}`, { headers }, "Defaults fetch failed")
    if (!response.ok) return fallback
    const parsed = decode(yield* json(response, "Defaults fetch failed"))
    if (Option.isNone(parsed)) return fallback
    const chosen = scope.token ? parsed.value.defaultModel : parsed.value.defaultFreeModel
    return chosen ? stripProviderPrefix(chosen) : fallback
  }).pipe(Effect.orElseSucceed(() => fallback))
}

export function stripProviderPrefix(modelID: string): string {
  return modelID.startsWith("kilo/") ? modelID.slice("kilo/".length) : modelID
}
