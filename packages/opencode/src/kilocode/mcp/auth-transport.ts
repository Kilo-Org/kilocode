import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { probe } from "./sse-probe"

export type AuthTransport = StreamableHTTPClientTransport | SSEClientTransport

export interface AuthTransportOptions {
  authProvider: OAuthClientProvider
  headers?: Record<string, string>
}

/**
 * Build the transport candidates a remote MCP sign-in flow tries, in fallback order.
 *
 * StreamableHTTP comes first because it is the MCP-spec transport. Legacy SSE-only servers and
 * the gateways in front of them answer its POST `initialize` with `405 Method Not Allowed`, and
 * the SDK treats that as a hard `StreamableHTTPError` instead of starting OAuth: on that path
 * only a 401 or a 403 `insufficient_scope` begins the OAuth flow, so a 405 never produces an
 * authorization URL. The SSE transport is the fallback. Its opening GET event-stream probe
 * receives `401` with a `WWW-Authenticate` header, which is the SDK's entry point into
 * `_authThenStart()` -> `auth()` -> `redirectToAuthorization()`, i.e. the OAuth browser flow.
 *
 * `probe` only normalizes the optional GET event-stream probe (a 200 whose body is not an event
 * stream becomes a 405). OAuth discovery, dynamic registration, and token requests pass through
 * the wrapper untouched, so authentication itself is never rewritten.
 */
export function createAuthTransports(url: URL, options: AuthTransportOptions): AuthTransport[] {
  const remoteFetch = probe(fetch, url.href)
  const requestInit = options.headers ? { headers: options.headers } : undefined
  const transportOptions = {
    authProvider: options.authProvider,
    requestInit,
    fetch: remoteFetch,
  }
  return [new StreamableHTTPClientTransport(url, transportOptions), new SSEClientTransport(url, transportOptions)]
}
