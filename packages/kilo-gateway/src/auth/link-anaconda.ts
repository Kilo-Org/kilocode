/**
 * Anaconda account linking and login verification.
 *
 * Two entry points consumed by the device-auth callback:
 *
 * 1. checkAnacondaLogin(domain?) — reads the keyring and, if a key exists,
 *    calls /api/auth/passport to retrieve the associated email.
 *    Returns the email string or null.
 *
 * 2. linkAnacondaAccount(kiloToken) — calls /api/auth/kilo/api-key to obtain
 *    an Anaconda API key and writes it to the keyring.
 *    Returns true on success.
 *
 * Telemetry is dispatched by the caller (device-auth-tui) since kilo-gateway
 * cannot depend on kilo-telemetry (circular dependency).
 */

import { getApiKey, saveCredential } from "./anaconda-keyring.js"

const ANACONDA_DOMAIN = "anaconda.com"
const LINK_ENDPOINT = `https://${ANACONDA_DOMAIN}/api/auth/kilo/api-key`
const PASSPORT_ENDPOINT = `https://${ANACONDA_DOMAIN}/api/auth/passport`

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

/**
 * Check if the user is already logged into Anaconda.
 *
 * Reads the keyring for an existing API key. If one exists, calls the
 * Anaconda passport endpoint to retrieve the associated email.
 *
 * @returns The Anaconda account email, or null if not logged in or passport fails
 */
export async function checkAnacondaLogin(): Promise<string | null> {
  const key = getApiKey(ANACONDA_DOMAIN)
  if (!key) return null

  const response = await fetch(PASSPORT_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) return null

  const data = (await response.json()) as PassportResponse
  return data.profile?.email || null
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
  const response = await fetch(LINK_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kiloToken}`,
      "Content-Type": "application/json",
    },
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
}
