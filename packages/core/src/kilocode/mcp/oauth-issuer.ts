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

/**
 * A registration response is always an `OAuthClientInformationFull`, so it carries `redirect_uris`. Only the
 * SDK's stamp of the configured client is a bare client, which is the shape of a binding. An authorization
 * server picks the `client_id` it returns, so an id match alone must not turn a registration into a binding.
 */
function isRegistration(info: StoredOAuthClientInformation): boolean {
  return "redirect_uris" in info
}

/** Client information for a configured client ID, given what is stored for it. */
export function configured(
  stored: StoredOAuthClientInformation | undefined,
  id: string,
  secret: string | undefined,
): StoredOAuthClientInformation | undefined {
  if (stored?.client_id === id && !isRegistration(stored))
    return { client_id: id, client_secret: secret, issuer: stored.issuer }
  // Nothing bound yet: the SDK binds the configured client on first use.
  if (stored?.issuer == null) return { client_id: id, client_secret: secret }
  // An expired registration makes the SDK register again rather than fall back to the configured secret.
  if (stored.client_secret_expires_at && stored.client_secret_expires_at < Date.now() / 1000) return undefined
  return stored
}

/** What to store for a configured client ID: its binding, or a client registered elsewhere. */
export function stored(info: StoredOAuthClientInformation, id: string): StoredOAuthClientInformation {
  if (info.client_id === id && !isRegistration(info)) return { client_id: id, issuer: info.issuer }
  return info
}

// No v1 `retain` here: v1 buffered a pending flow and committed it later, so it had to reconcile what the flow
// left behind. v2 finalizes from the same store the provider wrote to, so `configured`/`stored` cover every case.
export const binding: McpHost.OAuthBinding = {
  present: (input) => configured(input.stored, input.id, input.secret),
  persist: (input) => stored(input.info, input.id),
}
