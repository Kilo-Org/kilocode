import type { McpAuth } from "../../mcp/auth"
import { Effect } from "effect"
import type { Expected } from "./invalidation"

// A rejected OAuth refresh must not delete credentials a concurrent operation just
// rotated. The SDK calls `provider.invalidateCredentials()` after a refresh failure,
// but it does not say which credential was rejected. This fetch guard observes the
// actual token-endpoint request, captures the exact credential it presented, and
// records it on the provider right before the failure reaches invalidation.
//
// It is scoped by URL and request shape so it only ever inspects refresh-token grant
// POSTs against the authorization server's token endpoint. Authorization-code
// exchanges, discovery, and unrelated requests are never touched.

type BaseFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface OAuthFetchArgs {
  /** MCP server name the credentials are stored under. */
  name: string
  /** MCP server URL the provider is bound to. */
  serverUrl: string
  auth: McpAuth.Interface
  /** Provider whose `markRejected` receives the captured expectation. */
  provider: { markRejected(expected: Expected): void }
}

function formBody(init: RequestInit | undefined): URLSearchParams | undefined {
  const body = init?.body
  if (body instanceof URLSearchParams) return body
  if (typeof body === "string") {
    try {
      return new URLSearchParams(body)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Wrap a fetch so a refresh-token grant POST fingerprints the credential it presents.
 * The fingerprint is only recorded when the token endpoint actually rejects the
 * request with an OAuth error the SDK will turn into invalidation.
 */
export function oauthGuard(base: BaseFetch, args: OAuthFetchArgs): BaseFetch {
  return async (input, init) => {
    const form = init?.method === "POST" ? formBody(init) : undefined
    if (!form || form.get("grant_type") !== "refresh_token") return base(input, init)

    const refreshToken = form.get("refresh_token") ?? undefined
    const submittedClientId = form.get("client_id") ?? undefined

    const response = await base(input, init)
    if (response.ok) return response

    // Inspect a clone so the SDK still parses the original body.
    const error = await readError(response.clone())
    if (error !== "invalid_grant" && error !== "invalid_client" && error !== "unauthorized_client") return response

    const entry = await Effect.runPromise(args.auth.getForUrl(args.name, args.serverUrl))
    const matchesRefresh = refreshToken != null && entry?.tokens?.refreshToken === refreshToken
    const matchesClient = submittedClientId != null && entry?.clientInfo?.clientId === submittedClientId
    // Only fingerprint a credential the store already holds, so we never clear a value
    // that some other operation wrote while this request was in flight.
    if (matchesRefresh || matchesClient) {
      args.provider.markRejected({
        serverUrl: args.serverUrl,
        refreshToken,
        clientId: submittedClientId ?? entry?.clientInfo?.clientId,
        // Pin the issuer the entry is actually bound to, not the freshly discovered one, so the
        // comparison in the store matches the credential we are about to clear.
        issuer: entry?.tokens?.issuer ?? entry?.clientInfo?.issuer,
      })
    }
    return response
  }
}

async function readError(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body?.error === "string" ? body.error : undefined
  } catch {
    return undefined
  }
}
