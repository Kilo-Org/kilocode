// kilocode_change - new file
export * as McpHost from "./host.js"

import type { FetchLike, StoredOAuthClientInformation } from "@modelcontextprotocol/client"
import type { ConfigMCP } from "@opencode/schema/config/mcp"

/** OAuth settings of one remote server, as configured. Absent means every CIMD default applies. */
export type OAuthConfig = typeof ConfigMCP.OAuth.Type

/** Binds a stored OAuth client to the authorization server that issued it. */
export interface OAuthBinding {
  /** Client information to present for a configured client ID, given what is stored for it. */
  readonly present: (input: {
    readonly id: string
    readonly secret?: string
    readonly stored?: StoredOAuthClientInformation
  }) => StoredOAuthClientInformation | undefined
  /** What to persist when the authorization server registers or stamps a client for a configured client ID. */
  readonly persist: (input: {
    readonly id: string
    readonly info: StoredOAuthClientInformation
  }) => StoredOAuthClientInformation
}

export interface OAuth {
  /** Product name sent as `client_name` and in the initialize challenge. */
  readonly name?: string
  /** Product URI sent as `client_uri`. */
  readonly uri?: string
  /** Client ID Metadata Document to present for this attempt, or undefined to let the server register the client. */
  readonly document?: (config: OAuthConfig | undefined) => string | undefined
  /** Loopback callback for an attempt that configures neither `redirect_uri` nor `callback_port`. */
  readonly callback?: (config: OAuthConfig | undefined) => { readonly port: number; readonly path: string } | undefined
  /** Redirect a non-interactive registration must record so a later login reuses it, or undefined for the default. */
  readonly redirectUrl?: (config: OAuthConfig | undefined) => string | undefined
  /** Credential binding for a configured `client_id`. Absent keeps the upstream static client. */
  readonly binding?: OAuthBinding
}

/**
 * Embedding hooks for the MCP service. The upstream server leaves `host` unset and keeps its own
 * behavior; a host may set any hook to adapt the transport, OAuth identity or auth classification
 * without copying the MCP implementation.
 */
export interface Host {
  /** Wraps the remote transport fetch for one attempt; `endpoint` is the URL that attempt dials. */
  readonly fetch?: (fetch: FetchLike, endpoint: string) => FetchLike
  /** Client identity, client document and credential binding used for MCP OAuth. */
  readonly oauth?: OAuth
  /**
   * Recognizes a remote connection failure that asks for authentication, so the server reports
   * `needs_auth` with that message instead of `failed`. Only consulted for a server that may sign in.
   */
  readonly authFailure?: (message: string | undefined) => boolean
  /**
   * Recognizes a failure that will pass, such as a token refresh that could not reach its authorization
   * server, so the connect may retry it and a refused pooled handshake is not recorded as a refusal.
   */
  readonly transient?: (error: unknown) => boolean
}
