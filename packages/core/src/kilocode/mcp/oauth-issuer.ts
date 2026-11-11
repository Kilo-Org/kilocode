// kilocode_change - new file
export * as McpOAuthIssuer from "./oauth-issuer.js"

import type { StoredOAuthClientInformation } from "@modelcontextprotocol/client"
import type { McpHost } from "../../mcp/host.js"

/**
 * The MCP SDK binds stored OAuth credentials to the authorization server that issued them by stamping an
 * `issuer` on what it saves, and ignores credentials stamped for another server. A configured client is never
 * written to disk: only its binding (client ID and issuer) is stored. When the MCP server moves to another
 * authorization server, the SDK registers a new client there instead of presenting the configured secret, and
 * that registration replaces the binding.
 */

/** Client information for a configured client ID, given what is stored for it. */
export function configured(
  stored: StoredOAuthClientInformation | undefined,
  id: string,
  secret: string | undefined,
): StoredOAuthClientInformation | undefined {
  if (stored?.client_id === id) return { client_id: id, client_secret: secret, issuer: stored.issuer }
  // Nothing bound yet: the SDK binds the configured client on first use.
  if (stored?.issuer == null) return { client_id: id, client_secret: secret }
  // An expired registration makes the SDK register again rather than fall back to the configured secret.
  if (stored.client_secret_expires_at && stored.client_secret_expires_at < Date.now() / 1000) return undefined
  return { client_id: stored.client_id, client_secret: stored.client_secret, issuer: stored.issuer }
}

/** What to store for a configured client ID: its binding, or a client registered elsewhere. */
export function stored(info: StoredOAuthClientInformation, id: string): StoredOAuthClientInformation {
  if (info.client_id === id) return { client_id: id, issuer: info.issuer }
  return {
    client_id: info.client_id,
    client_secret: info.client_secret,
    client_id_issued_at: info.client_id_issued_at,
    client_secret_expires_at: info.client_secret_expires_at,
    issuer: info.issuer,
  }
}

// No v1 `retain` here: v1 buffered a pending flow and committed it later, so it had to reconcile what the flow
// left behind. v2 finalizes from the same store the provider wrote to, so `configured`/`stored` cover every case.
export const binding: McpHost.OAuthBinding = {
  present: (input) => configured(input.stored, input.id, input.secret),
  persist: (input) => stored(input.info, input.id),
}
