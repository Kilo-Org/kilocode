import {
  buildKiloHeaders,
  DEFAULT_KILO_API_URL,
  getDefaultHeaders,
  getKiloUrlFromToken,
  resolveKiloOpenRouterBaseUrl,
} from "@kilocode/kilo-gateway"
import { Effect, Option, Redacted } from "effect"
import z from "zod"
import { CloudAuth } from "../cloud/auth"
import { readBoundedJson } from "../cloud/response-json"

/**
 * Organization browser policy (D16): `browserControl` decides whether browser tools run
 * and where, `browserAllowedOrigins` grants every class on an origin. Read from the cloud
 * API, cached briefly, and never fatal: a missing sign-in or an unreachable API means no
 * policy, so a local session keeps working.
 */
export namespace BrowserPolicy {
  export type Control = "allow" | "playwright_only" | "off"
  export type Policy = { control: Control; origins: readonly string[] }

  export const NONE: Control = "allow"

  const TIMEOUT = 10_000
  const TTL = 60_000
  const LIMIT = 100

  // Non-strict: the cloud may add fields before the CLI knows them.
  const Response = z.object({
    browserControl: z.enum(["allow", "playwright_only", "off"]),
    browserAllowedOrigins: z.array(z.string()).default([]),
  })

  /** Validate an API body; an invalid body means no policy, not a broken session. */
  export function parse(value: unknown): Policy | undefined {
    const parsed = Response.safeParse(value)
    if (!parsed.success) return undefined
    return { control: parsed.data.browserControl, origins: parsed.data.browserAllowedOrigins }
  }

  type Entry = { value: Policy | undefined; expires: number }
  const cache = new Map<string, Entry>()

  export interface Options {
    readonly fetch?: (request: Request) => Promise<Response>
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly now?: () => number
    /** Credential source; tests and callers with resolved credentials bypass CloudAuth. */
    readonly auth?: () => Effect.Effect<CloudAuth.Resolved | undefined>
  }

  async function request(
    fetchImpl: (request: Request) => Promise<Response>,
    base: string,
    token: string,
    organizationID: string,
  ) {
    const url = new URL(`../organizations/${encodeURIComponent(organizationID)}/browser-policy`, base)
    const response = await fetchImpl(
      new Request(url.toString(), {
        headers: {
          ...getDefaultHeaders(),
          ...buildKiloHeaders(undefined, { kilocodeOrganizationId: organizationID }),
          "X-KILOCODE-FEATURE": "kilo-cli",
          Authorization: `Bearer ${token}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT),
      }),
    )
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return undefined
    }
    return parse(await readBoundedJson(response))
  }

  /** The active organization's policy, or undefined when there is none to apply. */
  export function get(options: Options = {}) {
    return Effect.gen(function* () {
      const auth = yield* options.auth
        ? options.auth()
        : CloudAuth.resolve({ env: options.env }).pipe(
            Effect.option,
            Effect.map((value) => (Option.isNone(value) ? undefined : value.value)),
            Effect.catchCause(() => Effect.succeed(undefined)),
          )
      if (!auth?.organizationID) return undefined
      const organizationID = auth.organizationID
      const token = Redacted.value(auth.token)
      const env = options.env ?? process.env
      const now = options.now ?? Date.now

      const key = `${organizationID}\u0000${token}`
      const hit = cache.get(key)
      if (hit && hit.expires > now()) return hit.value

      const base = resolveKiloOpenRouterBaseUrl({
        baseURL: getKiloUrlFromToken(env.KILO_API_URL?.trim() || DEFAULT_KILO_API_URL, token),
      })
      const value = yield* Effect.tryPromise({
        try: () => request(options.fetch ?? ((item: Request) => globalThis.fetch(item)), base, token, organizationID),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.succeed<Policy | undefined>(undefined)))

      if (cache.size >= LIMIT) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      cache.set(key, { value, expires: now() + TTL })
      return value
    }).pipe(Effect.catchCause(() => Effect.succeed<Policy | undefined>(undefined)))
  }

  /** Whether the policy allows every class on this origin without a prompt. */
  export function allows(policy: Policy | undefined, origin: string) {
    return policy?.origins.includes(origin) === true
  }
}
