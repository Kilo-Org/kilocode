import { discoverAuthorizationServerMetadata, refreshAuthorization } from "@modelcontextprotocol/sdk/client/auth.js"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import type { McpAuth } from "../../mcp/auth"

// Some MCP servers reject an expired access token with `403` instead of `401`. The MCP SDK
// only retries a request as an authentication failure on `401`, so an expired-but-refreshable
// token is classified as `needs_auth` and the user is asked to sign in again. Refresh a stored
// token that has expired (or is about to) before the connection sends it, so the server
// reconnects silently.
//
// The refresh is done against the authorization server the credentials are bound to, not the
// resource URL: the SDK's fallback discovery from the resource origin can resolve a different
// authorization server, which would make it discard the very token we are trying to refresh.
//
// The refresh is single-flight per server URL. Several directory instances (a worktree and its
// primary checkout, for example) share one `mcp-auth.json`, and refresh tokens rotate, so two
// concurrent refreshes must not present the same token.

/** Refresh when the stored token has this little life left, covering clock skew and slow connects. */
const SKEW_MS = 30_000

const log = Log.create({ service: "mcp.oauth-refresh" })

const inflight = new Map<string, Promise<void>>()

export interface RefreshArgs {
  /** MCP server name the credentials are stored under. */
  name: string
  /** MCP server URL the credentials are bound to. */
  serverUrl: string
  auth: McpAuth.Interface
  /** Fetch used for discovery and the token request; carries the OAuth refresh guard. */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

/**
 * Refresh an expired stored OAuth token so the next request carries a valid one.
 * Never throws: a refresh that fails leaves the stored credential in place for the
 * normal connect path to classify as `needs_auth`.
 */
export function refreshExpired(args: RefreshArgs): Promise<void> {
  const key = `${args.name}\u0000${args.serverUrl}`
  const active = inflight.get(key)
  if (active) return active
  const run = attempt(args).finally(() => {
    if (inflight.get(key) === run) inflight.delete(key)
  })
  inflight.set(key, run)
  return run
}

async function attempt(args: RefreshArgs): Promise<void> {
  const entry = await Effect.runPromise(args.auth.getForUrl(args.name, args.serverUrl)).catch((err) => {
    log.warn("could not read stored credentials", { server: args.name, err })
    return undefined
  })
  const tokens = entry?.tokens
  const clientInfo = entry?.clientInfo
  if (!tokens?.refreshToken || !clientInfo) return
  if (tokens.expiresAt == null || tokens.expiresAt * 1000 > Date.now() + SKEW_MS) return

  const issuer = tokens.issuer ?? clientInfo.issuer
  if (!issuer) return

  await refresh(args, issuer, tokens.refreshToken, clientInfo).catch((err) => {
    log.info("expired MCP token could not be refreshed", { server: args.name, err })
  })
}

async function refresh(
  args: RefreshArgs,
  issuer: string,
  refreshToken: string,
  clientInfo: McpAuth.ClientInfo,
): Promise<void> {
  const metadata = await discoverAuthorizationServerMetadata(issuer, { fetchFn: args.fetch })
  const next = await refreshAuthorization(issuer, {
    metadata,
    clientInformation: { client_id: clientInfo.clientId, client_secret: clientInfo.clientSecret },
    refreshToken,
    fetchFn: args.fetch,
  })
  await Effect.runPromise(
    args.auth.updateTokens(
      args.name,
      {
        accessToken: next.access_token,
        refreshToken: next.refresh_token ?? refreshToken,
        expiresAt: next.expires_in ? Date.now() / 1000 + next.expires_in : undefined,
        scope: next.scope,
        issuer,
      },
      args.serverUrl,
    ),
  )
  log.info("refreshed expired MCP token", { server: args.name, issuer })
}
