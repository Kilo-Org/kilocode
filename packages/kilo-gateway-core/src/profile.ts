export * as KiloProfile from "./profile.js"

import { Effect, Schema } from "effect"
import { json, request } from "./http.js"

export const Organization = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.optional(Schema.String),
})
export type Organization = typeof Organization.Type

// The backend returns `{ user: { email, name }, organizations, ... }`; older responses are flat.
const Response = Schema.Struct({
  user: Schema.optional(
    Schema.Struct({
      email: Schema.optional(Schema.String),
      name: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
  email: Schema.optional(Schema.String),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  organizations: Schema.optional(Schema.Array(Organization)),
  selectedOrganizationId: Schema.optional(Schema.NullOr(Schema.String)),
  hasPersonalAccount: Schema.optional(Schema.NullOr(Schema.Boolean)),
})

export interface Info {
  readonly email: string
  readonly name?: string
  readonly organizations: readonly Organization[]
  readonly selectedOrganizationId?: string
  readonly hasPersonalAccount?: boolean
}

export function get(server: string, token: string) {
  return Effect.gen(function* () {
    const response = yield* request(`${server}/api/profile`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    })
    if (response.status === 401 || response.status === 403) return yield* Effect.fail(new Error("Invalid token"))
    if (!response.ok) return yield* Effect.fail(new Error(`Failed to fetch profile: ${response.status}`))
    const data = yield* json(response, Response)
    const name = data.user?.name ?? data.name
    return {
      email: data.user?.email ?? data.email ?? "",
      ...(name ? { name } : {}),
      organizations: data.organizations ?? [],
      ...(data.selectedOrganizationId ? { selectedOrganizationId: data.selectedOrganizationId } : {}),
      ...(typeof data.hasPersonalAccount === "boolean" ? { hasPersonalAccount: data.hasPersonalAccount } : {}),
    } satisfies Info
  })
}

/**
 * The team a new login uses, or `null` for the personal account. Prefers the team the backend
 * selected, and falls back to the first team when the account has no personal account.
 * Same rule as v1 `defaultOrganizationId`.
 */
export function defaultOrganizationID(profile: Info): string | null {
  const selected = profile.organizations.find((item) => item.id === profile.selectedOrganizationId)
  if (selected) return selected.id
  if (profile.hasPersonalAccount === false) return profile.organizations[0]?.id ?? null
  return null
}
