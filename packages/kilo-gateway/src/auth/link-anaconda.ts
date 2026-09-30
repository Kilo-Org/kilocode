/**
 * Anaconda account linking and login verification.
 *
 * Two entry points:
 *
 * 1. checkAnacondaLogin() — reads the keyring and, if a key exists,
 *    calls /api/auth/passport to retrieve the associated email.
 *    Returns { hasKey, email } so callers can distinguish "no key"
 *    from "key exists but passport failed".
 *
 * 2. linkAnacondaAccount(kiloToken) — calls /api/auth/kilo/api-key to obtain
 *    an Anaconda API key and writes it to the keyring.
 *    Returns true on success, false on any failure.
 *
 * Telemetry is dispatched by the orchestration layer in
 * packages/opencode/src/kilocode/provider/anaconda-link.ts since
 * kilo-gateway cannot depend on kilo-telemetry (circular dependency).
 */

import { getApiKey, saveCredential } from "./anaconda-keyring.js"

const ANACONDA_DOMAIN = "anaconda.com"
const LINK_ENDPOINT = `https://${ANACONDA_DOMAIN}/api/auth/kilo/api-key`
const PASSPORT_ENDPOINT = `https://${ANACONDA_DOMAIN}/api/auth/passport`
const FETCH_TIMEOUT_MS = 10_000

interface LinkKeyInfo {
  id: string
  name: string
  user_id: string
  scopes: string[]
  tags: string[]
}

interface LinkResponse {
  api_key: string
  key: LinkKeyInfo
}

interface PassportProfile {
  email: string
}

interface PassportResponse {
  user_id: string
  profile: PassportProfile
}

export interface AnacondaLoginStatus {
  /** Whether an API key exists in the keyring. */
  hasKey: boolean
  /** The email from the Anaconda passport, or null if passport call failed or no key. */
  email: string | null
}

/**
 * Check if the user is already logged into Anaconda.
 *
 * Reads the keyring for an existing API key. If one exists, calls the
 * Anaconda passport endpoint to retrieve the associated email.
 *
 * Returns both `hasKey` (whether a keyring entry exists) and `email`
 * (the passport email) so callers can distinguish "no key" from
 * "key exists but passport failed" and avoid overwriting credentials
 * on transient failures.
 */
export async function checkAnacondaLogin(): Promise<AnacondaLoginStatus> {
  const key = getApiKey(ANACONDA_DOMAIN)
  if (!key) return { hasKey: false, email: null }

  const response = await fetch(PASSPORT_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!response.ok) return { hasKey: true, email: null }

  const data = (await response.json()) as PassportResponse
  return { hasKey: true, email: data.profile?.email || null }
}

/**
 * Call the Anaconda link-kilo endpoint and write the resulting API key
 * to the anaconda keyring.
 *
 * Should only be called when checkAnacondaLogin() returns null.
 *
 * @param kiloToken - The Kilo auth token (used as Bearer credential)
 * @returns true on success, false on failure
 */
export async function linkAnacondaAccount(kiloToken: string): Promise<boolean> {
  try {
    const response = await fetch(LINK_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kiloToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!response.ok) return false

    const data = (await response.json()) as LinkResponse

    if (!data.api_key) return false

    saveCredential({
      apiKey: data.api_key,
      domain: ANACONDA_DOMAIN,
      userId: data.key?.user_id,
    })

    return true
  } catch {
    return false
  }
}
