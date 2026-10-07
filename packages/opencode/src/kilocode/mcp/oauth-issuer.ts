import type { OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js"
import type { McpAuth } from "../../mcp/auth"

// The MCP SDK binds stored OAuth credentials to the authorization server that issued
// them by stamping an `issuer` on what it saves, and ignores credentials stamped for a
// different server. Pre-registered credentials (a configured client ID) are never
// written to disk, so only their binding is stored: the client ID and its issuer.

/** Issuer the stored binding records for the configured client ID. */
export function bound(info: McpAuth.ClientInfo | undefined, id: string) {
  if (info?.clientId !== id) return undefined
  return info.issuer
}

/** Binding to store for the configured client ID, without its secret. */
export function binding(info: OAuthClientInformationMixed | undefined, id: string): McpAuth.ClientInfo | undefined {
  if (info?.client_id !== id) return undefined
  return { clientId: id, issuer: info.issuer }
}

/**
 * Binding to keep after an authorization flow: the one the SDK just saved, or the stored
 * one. A client registered at another authorization server never replaces it.
 */
export function retain(
  info: OAuthClientInformationMixed | undefined,
  stored: McpAuth.ClientInfo | undefined,
  id: string,
): McpAuth.ClientInfo | undefined {
  const next = binding(info, id)
  if (next) return next
  if (stored?.clientId !== id) return undefined
  return { clientId: id, issuer: stored.issuer }
}
