import { Effect, Option, Schema } from "effect"
import { json, request } from "./http.js"
import { KiloServer } from "./server.js"

/**
 * Organization browser policy (D16): `browserControl` decides whether the browser tools run and where,
 * `browserAllowedOrigins` grants every class on an origin without a prompt. Read from the cloud API and never fatal: a
 * missing sign-in, a personal account or an unreachable API means no policy, so a local session keeps working.
 */
export namespace KiloBrowserPolicy {
  export type Control = "allow" | "playwright_only" | "off"
  export type Policy = { control: Control; origins: readonly string[] }

  const Response = Schema.Struct({
    browserControl: Schema.Literals(["allow", "playwright_only", "off"]),
    // Non-strict: the cloud may add fields before this client knows them.
    browserAllowedOrigins: Schema.optionalKey(Schema.Array(Schema.String)),
  })
  const decode = Schema.decodeUnknownOption(Response)

  export interface Scope {
    readonly server: string
    readonly token?: string
    readonly organizationID?: string | null
    // The configured or token-embedded server URL, before it becomes the canonical API root.
    readonly endpoint?: string
  }

  /** `true` when the endpoint is the Kilo API, so a custom or self-hosted server gets no request. */
  function kiloOrigin(endpoint: string) {
    if (KiloServer.isConfiguredBase(endpoint)) return true
    return URL.parse(endpoint)?.origin === URL.parse(KiloServer.fromEnv())?.origin
  }

  /** Validate an API body; an invalid body means no policy, not a broken session. */
  export function parse(value: unknown): Policy | undefined {
    const parsed = decode(value)
    if (Option.isNone(parsed)) return undefined
    return { control: parsed.value.browserControl, origins: parsed.value.browserAllowedOrigins ?? [] }
  }

  /** The organization's policy, or `undefined` when there is none to apply. */
  export function get(scope: Scope): Effect.Effect<Policy | undefined> {
    if (scope.endpoint && !kiloOrigin(scope.endpoint)) return Effect.succeed(undefined)
    const organizationID = scope.organizationID
    if (!organizationID) return Effect.succeed(undefined)
    return Effect.gen(function* () {
      const url = KiloServer.apiUrl(
        scope.server,
        "organizations",
        encodeURIComponent(organizationID),
        "browser-policy",
      )
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(scope.token ? { Authorization: `Bearer ${scope.token}` } : {}),
      }
      const response = yield* request(url, { headers }, "Browser policy fetch failed")
      if (!response.ok) return undefined
      return parse(yield* json(response, "Browser policy fetch failed"))
    }).pipe(Effect.orElseSucceed(() => undefined))
  }

  /** Whether the policy allows every class on this origin without a prompt. */
  export function allows(policy: Policy | undefined, origin: string) {
    return policy?.origins.includes(origin) === true
  }
}
