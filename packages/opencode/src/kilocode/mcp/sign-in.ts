import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"

// An explicit sign-in must end with credentials, not merely with a connected transport.
//
// The SDK starts OAuth only when a request is answered with HTTP 401. MCP authorization is
// evaluated per request, so a resource server may accept the unauthenticated `initialize` and
// `tools/list` and challenge only protected requests such as `tools/call` (Socket's remote MCP
// server does exactly this). An explicit sign-in against such a server connects without ever
// seeing a challenge and obtains no credentials.
//
// Like opencode v2's `McpOAuth.authorize`, start the authorization flow directly with the SDK's
// `auth()` orchestrator instead of waiting for a challenge. It performs the same discovery,
// registration, scope, resource, and PKCE handling as a 401-triggered flow. A server that offers
// no way to sign in fails that flow, and the sign-in is reported as failed.

export type Outcome =
  /** The flow already holds credentials; the connection is authenticated. */
  | { type: "authorized" }
  /** An authorization URL was handed to the provider's `redirectToAuthorization`. */
  | { type: "redirect" }
  | { type: "failed"; error: string }

export async function settle(input: {
  name: string
  url: URL
  provider: OAuthClientProvider
  scope?: string
}): Promise<Outcome> {
  if (await input.provider.tokens()) return { type: "authorized" }

  const result = await auth(input.provider, { serverUrl: input.url, scope: input.scope }).catch((err: unknown) =>
    err instanceof Error ? err : new Error(String(err)),
  )
  if (result instanceof Error)
    return { type: "failed", error: `MCP server "${input.name}" could not start OAuth sign-in: ${result.message}` }
  if (result === "AUTHORIZED") return { type: "authorized" }
  return { type: "redirect" }
}
