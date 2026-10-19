export * as KiloProfile from "./profile.js"

import { Effect, Option, Schema } from "effect"
import { json, request } from "./http.js"
import { KiloServer } from "./server.js"

const Organization = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.optional(Schema.String),
})

// `/api/profile` has shipped with `email` and `name` either under `user` or at the top level.
const Response = Schema.Struct({
  user: Schema.optional(
    Schema.Struct({
      email: Schema.optional(Schema.NullOr(Schema.String)),
      name: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
  email: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  organizations: Schema.optional(Schema.NullOr(Schema.Array(Organization))),
  selectedOrganizationId: Schema.optional(Schema.NullOr(Schema.String)),
  hasPersonalAccount: Schema.optional(Schema.NullOr(Schema.Boolean)),
})

export type Organization = typeof Organization.Type

export interface Info {
  readonly email: string
  readonly name?: string
  readonly organizations: readonly Organization[]
  readonly selectedOrganizationId?: string
  readonly hasPersonalAccount?: boolean
}

const decode = Schema.decodeUnknownOption(Response)

const BalanceResponse = Schema.Struct({
  balance: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  isDepleted: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
})
const decodeBalance = Schema.decodeUnknownOption(BalanceResponse)

export interface Balance {
  readonly balance: number
  readonly isDepleted?: boolean
}

export function balance(
  server: string,
  token: string,
  organizationID?: string | null,
): Effect.Effect<Balance | null> {
  return Effect.gen(function* () {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(organizationID ? { "x-kilocode-organizationid": organizationID } : {}),
    }
    const response = yield* request(
      `${KiloServer.normalize(server)}/api/profile/balance`,
      { headers },
      "Balance fetch failed",
    )
    if (!response.ok) return null
    const parsed = decodeBalance(yield* json(response, "Balance fetch failed"))
    if (Option.isNone(parsed)) return null
    return {
      balance: parsed.value.balance ?? 0,
      ...(typeof parsed.value.isDepleted === "boolean" ? { isDepleted: parsed.value.isDepleted } : {}),
    }
  }).pipe(Effect.orElseSucceed(() => null))
}

export function get(server: string, token: string): Effect.Effect<Info, Error> {
  return Effect.gen(function* () {
    const response = yield* request(
      KiloServer.apiUrl(server, "profile"),
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
      "Profile fetch failed",
    )
    if (response.status === 401 || response.status === 403) {
      return yield* Effect.fail(new Error("Invalid token"))
    }
    if (!response.ok) {
      return yield* Effect.fail(new Error(`Profile fetch failed with status ${response.status}`))
    }
    const parsed = decode(yield* json(response, "Profile fetch failed"))
    if (Option.isNone(parsed)) return yield* Effect.fail(new Error("Invalid Kilo profile response"))
    const body = parsed.value
    const name = body.user?.name ?? body.name ?? undefined
    return {
      email: body.user?.email ?? body.email ?? "",
      ...(name ? { name } : {}),
      organizations: body.organizations ?? [],
      ...(body.selectedOrganizationId ? { selectedOrganizationId: body.selectedOrganizationId } : {}),
      ...(typeof body.hasPersonalAccount === "boolean" ? { hasPersonalAccount: body.hasPersonalAccount } : {}),
    }
  })
}

// Same rule as v1 `defaultOrganizationId` (`packages/kilo-gateway/src/api/profile.ts`):
// prefer the team selected on the backend; otherwise use the first team only when the
// account has no personal account.
export function defaultOrganizationID(profile: Info): string | null {
  const ids = new Set(profile.organizations.map((org) => org.id))
  if (profile.selectedOrganizationId && ids.has(profile.selectedOrganizationId)) {
    return profile.selectedOrganizationId
  }
  if (profile.hasPersonalAccount === false) return profile.organizations[0]?.id ?? null
  return null
}
