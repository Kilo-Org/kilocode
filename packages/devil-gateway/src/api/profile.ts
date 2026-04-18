import { select } from "@clack/prompts"
import type { DevilcodeProfile, Organization, DevilcodeBalance } from "../types.js"
import { DEVIL_API_BASE, DEFAULT_MODEL, DEFAULT_FREE_MODEL } from "./constants.js"

/**
 * Fetch user profile from Devil API
 */
export async function fetchProfile(token: string): Promise<DevilcodeProfile> {
  const response = await fetch(`${DEVIL_API_BASE}/api/profile`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Invalid token")
    }
    throw new Error(`Failed to fetch profile: ${response.status}`)
  }

  const data = (await response.json()) as {
    user?: { email?: string; name?: string }
    email?: string
    name?: string
    organizations?: Organization[]
  }
  // Backend returns { user: { email, name, ... }, organizations }
  // Transform to flat DevilcodeProfile structure
  return {
    email: data.user?.email ?? data.email ?? "",
    name: data.user?.name ?? data.name,
    organizations: data.organizations,
  }
}

/**
 * Alias for compatibility with existing code
 */
export const getDevilProfile = fetchProfile

// devilcode_change start - audit OB4: discriminated balance result so callers can surface
// auth/transport failures to the user instead of silently rendering null.
export type FetchBalanceResult =
  | { ok: true; balance: DevilcodeBalance }
  | { ok: false; status?: number; error: string }

/**
 * Fetch user balance from Devil API.
 *
 * Discriminated result: success carries balance; failure carries upstream status + reason.
 * Use {@link fetchBalance} for the legacy null-on-error behavior.
 */
export async function fetchBalanceResult(token: string, organizationId?: string): Promise<FetchBalanceResult> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }
    if (organizationId) {
      headers["x-devilcode-organizationid"] = organizationId
    }

    const response = await fetch(`${DEVIL_API_BASE}/api/profile/balance`, { headers })

    if (!response.ok) {
      console.warn(`Failed to fetch balance: ${response.status}`)
      return { ok: false, status: response.status, error: `upstream returned ${response.status}` }
    }

    const data = (await response.json()) as { balance?: number }
    return { ok: true, balance: { balance: data.balance ?? 0 } }
  } catch (error) {
    console.warn("Error fetching balance:", error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Backwards-compatible helper that flattens errors to null. Prefer
 * {@link fetchBalanceResult} so callers can act on auth/transport failures.
 */
export async function fetchBalance(token: string, organizationId?: string): Promise<DevilcodeBalance | null> {
  const r = await fetchBalanceResult(token, organizationId)
  return r.ok ? r.balance : null
}
// devilcode_change end

/**
 * Alias for compatibility with existing code
 */
export const getDevilBalance = fetchBalance

/**
 * Fetch default model for a given organization context
 * When token is provided, returns the authenticated user's default model
 * When no token is provided, returns the default free model for anonymous usage
 */
export async function fetchDefaultModel(token?: string, organizationId?: string): Promise<string> {
  const path = organizationId ? `/api/organizations/${organizationId}/defaults` : `/api/defaults`
  const url = `${DEVIL_API_BASE}${path}`

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const response = await fetch(url, { headers })

    if (!response.ok) {
      return token ? DEFAULT_MODEL : DEFAULT_FREE_MODEL
    }

    const data = (await response.json()) as { defaultModel?: string; defaultFreeModel?: string }
    if (token) {
      return data.defaultModel || DEFAULT_MODEL
    }
    return data.defaultFreeModel || DEFAULT_FREE_MODEL
  } catch {
    return token ? DEFAULT_MODEL : DEFAULT_FREE_MODEL
  }
}

/**
 * Alias for compatibility with existing code
 */
export const getDevilDefaultModel = fetchDefaultModel

/**
 * Fetch both profile and balance in parallel
 */
export async function fetchProfileWithBalance(token: string): Promise<{
  profile: DevilcodeProfile
  balance: DevilcodeBalance | null
}> {
  const [profile, balance] = await Promise.all([fetchProfile(token), fetchBalance(token)])
  return { profile, balance }
}

/**
 * Prompt user to select an organization or personal account
 * @param organizations List of organizations the user belongs to
 * @returns Organization ID or undefined for personal account
 */
export async function promptOrganizationSelection(organizations: Organization[]): Promise<string | undefined> {
  if (!organizations || organizations.length === 0) {
    return undefined
  }

  const choices = [
    { label: "Personal Account", value: "personal", hint: "Use your personal account" },
    ...organizations.map((org) => ({
      label: org.name,
      value: org.id,
      hint: `Organization`,
    })),
  ]

  const result = await select({
    message: "Select account",
    options: choices,
  })

  if (result === "personal") {
    return undefined
  }

  return result as string
}
