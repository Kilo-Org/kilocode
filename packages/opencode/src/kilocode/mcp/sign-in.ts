import { auth, discoverOAuthServerInfo, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"

// An explicit sign-in must end with credentials, not merely with a connected transport.
//
// The SDK starts OAuth only when a request is answered with HTTP 401. MCP authorization is
// evaluated per request, so a resource server may accept the unauthenticated `initialize` and
// `tools/list` and challenge only protected requests such as `tools/call` (Socket's remote MCP
// server does exactly this). An explicit sign-in against such a server connects without ever
// seeing a challenge and obtains no credentials.
//
// When the connection succeeded without credentials, look for the server's OAuth discovery
// metadata (RFC 9728 protected resource metadata, or the legacy authorization server metadata
// the SDK falls back to). If it is advertised, start the authorization flow through the SDK's
// own `auth()` orchestrator, which applies the same discovery, registration, scope, resource,
// and PKCE handling as a 401-triggered flow. Otherwise the server cannot issue credentials, and
// the sign-in is reported as failed instead of successful.

export type Outcome =
  /** The flow already holds credentials; the connection is authenticated. */
  | { type: "authorized" }
  /** An authorization URL was handed to the provider's `redirectToAuthorization`. */
  | { type: "redirect" }
  | { type: "failed"; error: string }

export async function settle(input: { name: string; url: URL; provider: OAuthClientProvider }): Promise<Outcome> {
  if (await input.provider.tokens()) return { type: "authorized" }

  const info = await discoverOAuthServerInfo(input.url).catch(() => undefined)
  const advertised = !!info?.resourceMetadata?.authorization_servers?.length || !!info?.authorizationServerMetadata
  if (!advertised)
    return {
      type: "failed",
      error: `MCP server "${input.name}" accepted the connection without requesting authorization and does not advertise OAuth metadata, so no credentials were obtained`,
    }

  const result = await auth(input.provider, { serverUrl: input.url }).catch((err: unknown) =>
    err instanceof Error ? err : new Error(String(err)),
  )
  if (result instanceof Error)
    return { type: "failed", error: `OAuth authorization could not start: ${result.message}` }
  if (result === "AUTHORIZED") return { type: "authorized" }
  return { type: "redirect" }
}
