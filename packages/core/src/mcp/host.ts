// kilocode_change - new file
export * as McpHost from "./host.js"

import type { FetchLike } from "@modelcontextprotocol/client"

export interface LocalCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

export interface OAuthClientMetadata {
  /** Product name sent as `client_name` and in the initialize challenge. */
  readonly name?: string
  /** Product URI sent as `client_uri`. */
  readonly uri?: string
  /** Hosted client metadata document used as the Client ID Metadata Document. */
  readonly documentUrl?: string
}

/**
 * Embedding hooks for the MCP service. The upstream server leaves `host` unset and keeps its own
 * behavior; a host may set any hook to adapt transport, command or OAuth identity without copying
 * the MCP implementation.
 */
export interface Host {
  /** Wraps the remote transport fetch for one attempt; `endpoint` is the URL that attempt dials. */
  readonly fetch?: (fetch: FetchLike, endpoint: string) => FetchLike
  /** Rewrites a local server command before it is spawned, for example to add container flags. */
  readonly localCommand?: (command: LocalCommand) => LocalCommand
  /** Client identity used for MCP OAuth registration. */
  readonly oauth?: OAuthClientMetadata
}
