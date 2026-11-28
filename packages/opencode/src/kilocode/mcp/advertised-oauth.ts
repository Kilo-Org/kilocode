import {
  auth,
  discoverOAuthProtectedResourceMetadata,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js"

/**
 * Some remote MCP servers answer an unauthenticated `initialize` with `200` instead of a `401`
 * challenge, but still publish RFC 9728 protected-resource metadata that names an authorization
 * server. Google's Workspace MCP servers (for example `https://drivemcp.googleapis.com/mcp/v1`)
 * behave this way: the session opens, but every tool call later fails because no token was sent.
 *
 * The SDK only starts OAuth on a `401`, so an explicit `kilo mcp auth` against such a server
 * connected anonymously and reported "Authentication successful!" without ever opening the
 * browser or storing a credential (Kilo-Org/kilocode#15492).
 *
 * When the user explicitly asks to authenticate and the connection succeeded without credentials,
 * look for the metadata the server advertises and, if it names an authorization server, start the
 * authorization code flow ourselves with the same provider the transport uses. The transport's
 * `finishAuth()` then completes the exchange exactly as it does for a challenged connection.
 */

export type Result =
  /** The server does not advertise OAuth; the anonymous connection is the intended one. */
  | { type: "none" }
  /** The provider was asked to redirect; the caller owns the captured authorization URL. */
  | { type: "redirect" }
  /** The SDK obtained credentials without a browser step (for example a valid refresh). */
  | { type: "authorized" }
  /** OAuth is advertised but the authorization server cannot register a client for us. */
  | { type: "registration"; error: string }

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** True when the server publishes protected-resource metadata naming an authorization server. */
export async function advertised(serverUrl: URL, fetchFn?: FetchLike): Promise<boolean> {
  const metadata = await discoverOAuthProtectedResourceMetadata(serverUrl, undefined, fetchFn).catch(() => undefined)
  return (metadata?.authorization_servers?.length ?? 0) > 0
}

function registrationFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /registration|client_id/i.test(message)
}

/**
 * Start OAuth for a server that accepted an anonymous connection. Resolves to `none` when the
 * server does not advertise OAuth, so callers can keep the existing anonymous behavior.
 */
export async function start(provider: OAuthClientProvider, serverUrl: URL, fetchFn?: FetchLike): Promise<Result> {
  if (await provider.tokens()) return { type: "none" }
  if (!(await advertised(serverUrl, fetchFn))) return { type: "none" }

  const outcome = await auth(provider, { serverUrl, fetchFn }).catch((error: unknown) => {
    if (registrationFailure(error)) return error instanceof Error ? error : new Error(String(error))
    throw error
  })
  if (outcome instanceof Error) {
    return {
      type: "registration",
      error: "Server does not support dynamic client registration. Please provide clientId in config.",
    }
  }
  return outcome === "REDIRECT" ? { type: "redirect" } : { type: "authorized" }
}
