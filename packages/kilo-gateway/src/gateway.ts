import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import { Credential } from "@opencode-ai/schema/credential"
import { IntegrationMethodID } from "@opencode-ai/schema/integration-id"
import { Clock, Effect, Schema } from "effect"

export interface GatewayOptions {
  readonly server?: string
  readonly pollIntervalMs?: number
  readonly sessions?: string
  readonly shareApp?: string
}

const NonEmpty = Schema.String.check(Schema.isMinLength(1))
const Organization = Schema.Struct({
  id: NonEmpty,
  name: NonEmpty,
  role: Schema.optionalKey(Schema.String),
})
const RawProfile = Schema.Struct({
  user: Schema.optionalKey(
    Schema.Struct({
      email: Schema.optionalKey(NonEmpty),
      name: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
  email: Schema.optionalKey(NonEmpty),
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  organizations: Schema.optionalKey(Schema.Array(Organization)),
  selectedOrganizationId: Schema.optionalKey(Schema.NullOr(NonEmpty)),
  hasPersonalAccount: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
})
const Device = Schema.Struct({
  code: NonEmpty,
  verificationUrl: NonEmpty,
  expiresIn: Schema.Finite.check(Schema.isGreaterThan(0)),
})
const Approved = Schema.Struct({
  status: Schema.Literal("approved"),
  token: NonEmpty,
  userEmail: NonEmpty,
})
const methodID = IntegrationMethodID.make("device")

export function serverUrl(input = "https://api.kilo.ai") {
  const url = httpUrl(input)
  if (url.search || url.hash) throw new Error("Kilo API URL must not contain a query or fragment")
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

function httpUrl(input: string) {
  const url = URL.parse(input)
  if (
    !url ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  ) {
    throw new Error("Kilo URLs must use HTTPS or HTTP loopback, without embedded credentials")
  }
  return url
}

function request(url: string, init?: RequestInit) {
  return Effect.tryPromise({
    try: (signal) => fetch(url, { ...init, signal, redirect: "error" }),
    catch: () => new Error("Kilo request failed"),
  })
}

function json<A>(response: Response, schema: Schema.Decoder<A>) {
  if (!response.ok) return Effect.fail(new Error(`Kilo request failed (HTTP ${response.status})`))
  return Effect.tryPromise({
    try: () => response.json(),
    catch: () => new Error("Invalid Kilo response"),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => new Error("Invalid Kilo response")),
  )
}

export function fetchAuthenticatedJSON<A>(
  server: string,
  token: string,
  path: string,
  schema: Schema.Decoder<A>,
  headers: Record<string, string> = {},
) {
  return Effect.gen(function* () {
    const base = yield* Effect.try({ try: () => serverUrl(server), catch: (cause) => cause })
    const response = yield* request(`${base}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...headers },
    })
    if (response.status === 401 || response.status === 403) {
      return yield* Effect.fail(new Error("Kilo authentication expired"))
    }
    return yield* json(response, schema)
  })
}

export const fetchProfile = Effect.fn(function* (server: string, token: string) {
  const value = yield* fetchAuthenticatedJSON(server, token, "/api/profile", RawProfile)
  const email = value.user?.email ?? value.email
  const name = value.user?.name !== undefined ? value.user.name : value.name
  return {
    ...(email === undefined ? {} : { email }),
    ...(name === undefined ? {} : { name }),
    organizations: value.organizations ?? [],
    ...(value.selectedOrganizationId === undefined ? {} : { selectedOrganizationId: value.selectedOrganizationId }),
    ...(value.hasPersonalAccount === undefined ? {} : { hasPersonalAccount: value.hasPersonalAccount }),
  }
})

export type Profile = Effect.Success<ReturnType<typeof fetchProfile>>

export function defaultOrganizationID(profile: Profile): string | null {
  if (typeof profile.selectedOrganizationId === "string") {
    if (profile.organizations.some((item) => item.id === profile.selectedOrganizationId)) {
      return profile.selectedOrganizationId
    }
    throw new Error("The selected Kilo organization is not available")
  }
  if (profile.selectedOrganizationId === null) {
    if (profile.hasPersonalAccount === false) throw new Error("This Kilo account has no personal account")
    return null
  }
  if (profile.hasPersonalAccount === true) return null
  if (profile.hasPersonalAccount === false && profile.organizations.length === 1) return profile.organizations[0].id
  if (profile.hasPersonalAccount !== false && profile.organizations.length === 0) return null
  throw new Error("Kilo account selection is ambiguous; select an account in Kilo before signing in")
}

export function deviceAuth(options: GatewayOptions = {}): IntegrationOAuthMethodRegistration {
  const server = serverUrl(options.server)
  const interval = options.pollIntervalMs ?? 3000
  if (!Number.isFinite(interval) || interval <= 0) throw new Error("Kilo poll interval must be positive")
  return {
    integrationID: "kilo",
    method: { id: methodID, type: "oauth", label: "Sign in with Kilo" },
    authorize: () =>
      Effect.gen(function* () {
        const response = yield* request(`${server}/api/device-auth/codes`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
        })
        if (response.status === 429) {
          return yield* Effect.fail(new Error("Too many pending Kilo authorization requests; try again later"))
        }
        const device = yield* json(response, Device)
        const url = yield* Effect.try({ try: () => httpUrl(device.verificationUrl).href, catch: (cause) => cause })
        const expiresAt = (yield* Clock.currentTimeMillis) + device.expiresIn * 1000
        const poll: Effect.Effect<Credential.OAuth, unknown> = Effect.gen(function* () {
          const remaining = expiresAt - (yield* Clock.currentTimeMillis)
          if (remaining <= 0) return yield* Effect.fail(new Error("Kilo authorization code expired"))
          const response = yield* request(`${server}/api/device-auth/codes/${encodeURIComponent(device.code)}`)
          if (response.status === 202) {
            yield* Effect.sleep(Math.min(interval, remaining))
            return yield* poll
          }
          if (response.status === 403) return yield* Effect.fail(new Error("Kilo authorization was denied"))
          if (response.status === 410) return yield* Effect.fail(new Error("Kilo authorization code expired"))
          const approved = yield* json(response, Approved)
          const profile = yield* fetchProfile(server, approved.token)
          const organizationID = yield* Effect.try({
            try: () => defaultOrganizationID(profile),
            catch: (cause) => cause,
          })
          const organization = profile.organizations.find((item) => item.id === organizationID)
          return Credential.OAuth.make({
            type: "oauth",
            methodID,
            refresh: approved.token,
            access: approved.token,
            expires: 0,
            metadata: {
              ...profile,
              server,
              email: profile.email ?? approved.userEmail,
              organizationID,
              ...(organization ? { organizationName: organization.name } : {}),
            },
          })
        })
        return { mode: "auto" as const, url, instructions: `Enter code: ${device.code}`, expiresAt, callback: poll }
      }),
    label: (credential) => {
      if (typeof credential.metadata?.organizationName === "string") return credential.metadata.organizationName
      return typeof credential.metadata?.email === "string" ? credential.metadata.email : undefined
    },
  }
}
