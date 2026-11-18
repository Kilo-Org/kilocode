export * as KiloMcpRefresh from "./refresh.js"

import type { FetchLike } from "@modelcontextprotocol/client"
import { Clock, Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { Credential } from "../../credential.js"
import type { McpHost } from "../../mcp/host.js"

const due = (value: Credential.OAuth, now: number) =>
  Boolean(value.refresh) && value.expires !== 0 && value.expires <= now + 30_000

/** A resource may answer an expired token with 403, which never starts the SDK's 401 refresh flow. */
export const beforeConnect: NonNullable<McpHost.OAuth["beforeConnect"]> = Effect.fnUntraced(
  function* (config, row, client) {
    const clock = yield* Clock.Clock
    if (row.value.type !== "oauth" || !due(row.value, clock.currentTimeMillisUnsafe())) return
    const credentials = yield* Credential.Service
    const fetch = yield* FetchHttpClient.Fetch
    yield* credentials
      .refresh(row.id, {
        timeoutMs: config.timeout?.startup ?? 30_000,
        stale: due,
        refresh: (value) =>
          Effect.tryPromise(async (signal) => {
            const info = await client()
            const issuer = value.metadata?.issuer ?? info?.issuer
            if (!info || typeof issuer !== "string" || !issuer || (info.issuer && info.issuer !== issuer))
              throw new Error("Missing or mismatched MCP OAuth issuer binding")
            const { discoverAuthorizationServerMetadata, refreshAuthorization, resourceUrlFromServerUrl } =
              await import("@modelcontextprotocol/client")
            const fetchFn: FetchLike = (url, init) => {
              signal.throwIfAborted()
              return fetch(url, { ...init, signal })
            }
            const metadata = await discoverAuthorizationServerMetadata(issuer, { fetchFn })
            const tokens = await refreshAuthorization(issuer, {
              metadata,
              clientInformation: info,
              refreshToken: value.refresh,
              resource: resourceUrlFromServerUrl(config.url),
              fetchFn,
            })
            return Credential.OAuth.make({
              ...value,
              access: tokens.access_token,
              refresh: tokens.refresh_token ?? value.refresh,
              expires: tokens.expires_in === undefined ? 0 : clock.currentTimeMillisUnsafe() + tokens.expires_in * 1000,
              metadata: {
                ...value.metadata,
                issuer,
                tokenType: tokens.token_type,
                ...(tokens.scope !== undefined && { scope: tokens.scope }),
              },
            })
          }),
      })
      .pipe(
        Effect.catch(() => Effect.logDebug("mcp oauth pre-connect refresh unavailable", { credentialID: row.id })),
      )
  },
)

/**
 * The MCP SDK treats a token refresh that fails on the network, or with a 5xx, as a rejected credential: it
 * drops the refresh and starts a new browser sign-in, which a background connect reports as `needs_auth`. A DNS
 * or VPN outage after sleep then asks the user to sign in again although the stored credential is still good.
 *
 * Report such a refresh as `temporarily_unavailable` instead. The SDK rethrows that code without invalidating
 * anything, the connect fails as `failed` with the credential kept, and `KiloMcpRecovery` retries it.
 */
export const transient =
  (fetch: FetchLike): FetchLike =>
  async (url, init) => {
    if (!(init?.body instanceof URLSearchParams) || init.body.get("grant_type") !== "refresh_token")
      return fetch(url, init)
    const host = new URL(url).host
    const response = await fetch(url, init).catch((error: unknown) => {
      if (init.signal?.aborted) throw error
      return unavailable(
        `Token refresh could not reach ${host}: ${error instanceof Error ? error.message : String(error)} (temporarily_unavailable)`,
      )
    })
    if (!retryable(response.status)) return response
    // The transport below reports a refresh it could not complete as this OAuth error itself, with the cause and
    // the status it saw. Relabelling that answer would report its 503 instead.
    const answer: unknown = await response
      .clone()
      .json()
      .catch(() => undefined)
    if (typeof answer === "object" && answer !== null && "error" in answer && answer.error === "temporarily_unavailable")
      return response
    return unavailable(`Token refresh at ${host} failed with HTTP ${response.status} (temporarily_unavailable)`)
  }

/**
 * Whether a connect failed for a reason that will pass, so the connect may retry and a pooled handshake is not
 * recorded as a refusal. The SDK reports a refresh it gave up on as this code; no other failure carries it.
 */
export const isTransient = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "temporarily_unavailable"

// 408, 429 and 5xx are what `McpClient.isTransient` retries for an ordinary request; 501 will never recover.
const retryable = (status: number) => status === 408 || status === 429 || (status >= 500 && status !== 501)

// Imported on the failure path only: the SDK at module scope would join the host's startup module graph, and
// the startup ratchet (packages/kilo-cli/script/startup.ts) measures that graph.
const unavailable = async (message: string): Promise<never> => {
  const { OAuthError, OAuthErrorCode } = await import("@modelcontextprotocol/client")
  throw new OAuthError(OAuthErrorCode.TemporarilyUnavailable, message)
}
