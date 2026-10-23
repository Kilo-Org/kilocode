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
  // The configured or token-embedded server URL, before it becomes the canonical API root.
  readonly endpoint?: string
}

// Team callers select their first allowed model when defaults are unavailable, as in
// v1 `provider/catalog.ts:recommend`. Personal accounts on the Kilo API keep v2's Frontier fallback.
// As in v1, a custom or self-hosted server gets no defaults request and no fallback.
export function get(scope: Scope): Effect.Effect<string | undefined> {
  if (scope.endpoint && !kiloOrigin(scope.endpoint)) return Effect.succeed(undefined)
  const fallback = scope.token && scope.organizationID ? undefined : scope.token ? DEFAULT_MODEL : DEFAULT_FREE_MODEL
  return Effect.gen(function* () {
    const organizationID = scope.organizationID ?? null
    const url = organizationID
      ? KiloServer.apiUrl(scope.server, "organizations", encodeURIComponent(organizationID), "defaults")
      : KiloServer.apiUrl(scope.server, "defaults")
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(scope.token ? { Authorization: `Bearer ${scope.token}` } : {}),
    }
    const response = yield* request(url, { headers }, "Defaults fetch failed")
    if (!response.ok) return fallback
    const parsed = decode(yield* json(response, "Defaults fetch failed"))
    if (Option.isNone(parsed)) return fallback
    const chosen = scope.token ? parsed.value.defaultModel : parsed.value.defaultFreeModel
    return chosen ? stripProviderPrefix(chosen) : fallback
  }).pipe(Effect.orElseSucceed(() => fallback))
}

// v1 compares the endpoint origin with `KILO_API_BASE`. The configured AI Gateway base is the v2 form of
// v1's unset `baseURL`, so it counts as the Kilo API.
function kiloOrigin(endpoint: string) {
  if (KiloServer.isConfiguredBase(endpoint)) return true
  return URL.parse(endpoint)?.origin === URL.parse(KiloServer.fromEnv())?.origin
}

// Without a recommendation, v1 clients used the first provider model in `Provider.sort` order
// (`provider/provider.ts` on main): priority filter, then "latest", then ID, descending.
const PRIORITY = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
export function firstSorted(ids: readonly string[]): string | undefined {
  const rank = (id: string) => PRIORITY.findIndex((filter) => id.includes(filter))
  return ids.toSorted(
    (a, b) =>
      rank(b) - rank(a) ||
      Number(b.includes("latest")) - Number(a.includes("latest")) ||
      (a < b ? 1 : a > b ? -1 : 0),
  )[0]
}

export function stripProviderPrefix(modelID: string): string {
  return modelID.startsWith("kilo/") ? modelID.slice("kilo/".length) : modelID
}
