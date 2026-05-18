/**
 * ShareNext API client — boilerplate for issue #10281.
 *
 * Replaces the legacy `ingest.kilosessions.ai/session/:id` read path with the
 * upstream ShareNext endpoint:  GET /api/shares/:id/data → ShareData[]
 *
 * The response is a flat discriminated-union array instead of the old nested
 * `{ info, messages }` shape.  Use `transformShareData` in import.ts to fold
 * it back into the nested structure expected by local storage.
 */

import type * as SDK from "@kilocode/sdk/v2"
import { Auth } from "@/auth"
import { KILO_API_BASE } from "@kilocode/kilo-gateway"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Flat discriminated-union item returned by GET /api/shares/:id/data */
export type ShareData =
  | { type: "session"; data: SDK.Session }
  | { type: "message"; data: SDK.Message }
  | { type: "part"; data: SDK.Part }
  | { type: "session_diff"; data: unknown }
  | { type: "model"; data: unknown }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the share endpoint's origin matches the account base URL,
 * indicating that Kilo auth headers should be attached to the request.
 */
export function shouldAttachShareAuthHeaders(shareUrl: string, accountBaseUrl: string): boolean {
  try {
    return new URL(shareUrl).origin === new URL(accountBaseUrl).origin
  } catch {
    return false
  }
}

/** Resolve a Kilo bearer token from stored credentials. */
async function token(): Promise<string | undefined> {
  const auth = await Auth.get("kilo")
  if (auth?.type === "api" && auth.key.length > 0) return auth.key
  if (auth?.type === "oauth" && auth.access.length > 0) return auth.access
  if (auth?.type === "wellknown" && auth.token.length > 0) return auth.token
  return undefined
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Fetch flat share data from the ShareNext API.
 *
 * GET `<base>/api/shares/<shareId>/data` → `ShareData[]`
 *
 * Auth headers are attached when the endpoint origin matches `KILO_API_BASE`
 * (i.e. the default Kilo Console deployment).  Override the base URL via the
 * `KILO_API_URL` env var if needed.
 *
 * NOTE: This is a boilerplate stub.  A full production implementation should
 * wire retry logic, response validation (Zod/Schema), and error telemetry.
 */
export async function fetchShareData(shareId: string): Promise<ShareData[]> {
  const base = KILO_API_BASE
  const url = `${base}/api/shares/${encodeURIComponent(shareId)}/data`

  const headers: Record<string, string> = {}
  if (shouldAttachShareAuthHeaders(url, base)) {
    const t = await token()
    if (t) headers["Authorization"] = `Bearer ${t}`
  }

  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`ShareNext API error ${response.status}: ${response.statusText}`)
  }
  return response.json() as Promise<ShareData[]>
}

export * as ShareNextApi from "./share-next-api"
