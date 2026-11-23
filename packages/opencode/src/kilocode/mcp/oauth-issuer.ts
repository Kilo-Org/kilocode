import type { OAuthClientInformation, OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js"
import type { McpAuth } from "../../mcp/auth"

// The MCP SDK binds stored OAuth credentials to the authorization server that issued
// them by stamping an `issuer` on what it saves, and ignores credentials stamped for a
// different server. Pre-registered credentials (a configured client ID) are never
// written to disk: only their binding (client ID and issuer) is stored. When the MCP
// server moves to another authorization server, the SDK registers a new client there
// instead of presenting the configured secret, and that registration is stored in
// place of the binding.

/** Client information for a configured client ID, given what is stored for it. */
export function configured(
  info: McpAuth.ClientInfo | undefined,
  id: string,
  secret: string | undefined,
): OAuthClientInformation | undefined {
  if (info?.clientId === id) return { client_id: id, client_secret: secret, issuer: info.issuer }
  // Nothing bound yet: the SDK binds the configured client on first use.
  if (info?.issuer == null) return { client_id: id, client_secret: secret }
  // An expired registration makes the SDK register again rather than fall back to the
  // configured secret.
  if (info.clientSecretExpiresAt && info.clientSecretExpiresAt < Date.now() / 1000) return undefined
  return { client_id: info.clientId, client_secret: info.clientSecret, issuer: info.issuer }
}

/** What to store for a configured client ID: its binding, or a client registered elsewhere. */
export function stored(info: OAuthClientInformationMixed, id: string): McpAuth.ClientInfo {
  if (info.client_id === id) return { clientId: id, issuer: info.issuer }
  return {
    clientId: info.client_id,
    clientSecret: info.client_secret,
    clientIdIssuedAt: info.client_id_issued_at,
    clientSecretExpiresAt: info.client_secret_expires_at,
    issuer: info.issuer,
  }
}

/** Client information to keep after an authorization flow for a configured client ID. */
export function retain(
  info: OAuthClientInformationMixed | undefined,
  previous: McpAuth.ClientInfo | undefined,
  id: string,
): McpAuth.ClientInfo | undefined {
  if (info) return stored(info, id)
  if (previous?.clientId === id || previous?.issuer != null) return previous
  return undefined
}
