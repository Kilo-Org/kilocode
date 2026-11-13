export * as KiloMcpRefresh from "./refresh.js"

import type { FetchLike } from "@modelcontextprotocol/client"

/**
 * The MCP SDK treats a token refresh that fails on the network, or with a 5xx, as a rejected credential: it
 * drops the refresh and starts a new browser sign-in, which a background connect reports as `needs_auth`. A DNS
 * or VPN outage after sleep then asks the user to sign in again although the stored credential is still good.
 *
 * Report such a refresh as `temporarily_unavailable` instead. The SDK rethrows that code without invalidating
 * anything, the connect fails as `failed` with the credential kept, and `KiloMcpRecovery` retries it.
 */
export const transient =
  (fetch: FetchLike): FetchLike =>
  async (url, init) => {
    if (!(init?.body instanceof URLSearchParams) || init.body.get("grant_type") !== "refresh_token")
      return fetch(url, init)
    const host = new URL(url).host
    const response = await fetch(url, init).catch((error: unknown) => {
      if (init.signal?.aborted) throw error
      return unavailable(
        `Token refresh could not reach ${host}: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    if (response.status === 429 || (response.status >= 500 && response.status !== 501))
      return unavailable(`Token refresh at ${host} failed with HTTP ${response.status}`)
    return response
  }

// Imported on the failure path only: the SDK at module scope would join the host's startup module graph, and
// the startup ratchet (packages/kilo-cli/script/startup.ts) measures that graph.
const unavailable = async (message: string): Promise<never> => {
  const { OAuthError, OAuthErrorCode } = await import("@modelcontextprotocol/client")
  throw new OAuthError(OAuthErrorCode.TemporarilyUnavailable, message)
}
