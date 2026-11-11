// kilocode_change - new file
export * as McpHost from "./host.js"

import type { FetchLike, StoredOAuthClientInformation } from "@modelcontextprotocol/client"
import type { ConfigMCP } from "@opencode/schema/config/mcp"

export interface LocalCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

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
 * behavior; a host may set any hook to adapt transport, command or OAuth identity without copying
 * the MCP implementation.
 */
export interface Host {
  /** Wraps the remote transport fetch, for example to normalize an optional stream probe. */
  readonly fetch?: (fetch: FetchLike) => FetchLike
  /** Rewrites a local server command before it is spawned, for example to add container flags. */
  readonly localCommand?: (command: LocalCommand) => LocalCommand
  /** Client identity, client document and credential binding used for MCP OAuth. */
  readonly oauth?: OAuth
}
