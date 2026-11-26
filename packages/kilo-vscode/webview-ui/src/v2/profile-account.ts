// The decision that keeps the Kilo profile in step with the server account. It is pure, so the timing-sensitive
// cases the Profile view depends on are tested without a server or a webview.
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"

export type ProfileData = {
  profile: KiloGatewayRpc.Profile
  balance: KiloGatewayRpc.Balance | null
  kiloPass: KiloGatewayRpc.KiloPass
}

export type ProfileStatus = "expired" | "unavailable"

export type ProfileRead =
  | { kind: "ok"; data: ProfileData }
  | { kind: "signedOut" }
  | { kind: "expired" }
  | { kind: "unavailable" }

export interface ProfileRpc {
  authStatus: () => Promise<KiloGatewayRpc.AuthStatus>
  profile: () => Promise<KiloGatewayRpc.Profile>
  balance: () => Promise<KiloGatewayRpc.Balance | null>
  kiloPass: () => Promise<KiloGatewayRpc.KiloPass>
}

export type AccountAction = "none" | "hold" | "refresh" | "clear"

function isUnauthorized(error: unknown) {
  return typeof error === "object" && error !== null && "type" in error && error.type === "unauthorized"
}

/**
 * Read the Kilo profile and classify failures so the UI can tell a rejected
 * OAuth login ("expired") apart from nobody being signed in ("signedOut") and
 * from a temporary outage ("unavailable"). An API-key or env login rejected
 * with `unauthorized` maps to "signedOut", not "expired".
 */
export async function readProfile(rpc: ProfileRpc): Promise<ProfileRead> {
  const auth = await rpc.authStatus().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  if (!auth.ok) return isUnauthorized(auth.error) ? { kind: "signedOut" } : { kind: "unavailable" }
  if (!auth.value.authenticated) return { kind: "signedOut" }
  const [profile, balance, kiloPass] = await Promise.all([
    rpc.profile().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    rpc.balance().catch(() => null),
    rpc.kiloPass().catch(() => null),
  ])
  if (profile.ok) return { kind: "ok", data: { profile: profile.value, balance, kiloPass } }
  if (!isUnauthorized(profile.error)) return { kind: "unavailable" }
  if (auth.value.method !== "oauth") return { kind: "signedOut" }
  const latest = await rpc.authStatus().catch(() => auth.value)
  return latest.authenticated && latest.method === "oauth" ? { kind: "expired" } : { kind: "signedOut" }
}

/**
 * The action for the shown profile after a `provider.updated`: `none` keeps it, `hold` keeps an account through a
 * signed-out reading until the next event, `refresh` reloads it, and `clear` drops it.
 *
 * The Gateway publishes this event before it reloads, when its account is empty, so a signed-out reading can also come
 * from a team switch, a token refresh, or a retry. `held` is true after an earlier event held an account through such a
 * reading, which makes the next one a real sign-out.
 */
export function accountAction(
  shown: { profile: { organizationID: string | null } } | null | undefined,
  current: { authenticated: boolean; organizationID: string | null } | undefined,
  held: boolean,
  status?: ProfileStatus,
): AccountAction {
  if (shown === undefined) return "none"
  if (current?.authenticated)
    return shown && shown.profile.organizationID === current.organizationID && status === undefined
      ? "none"
      : "refresh"
  if (shown === null && status === undefined) return "none"
  return held ? "clear" : "hold"
}
