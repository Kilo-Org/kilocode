import { OpenCode, type OpenCodeClient } from "@opencode-ai/client"
import { ServiceStatus } from "@opencode-ai/protocol/groups/health"
import { Schema } from "effect"

/**
 * IDE host connection: verify an explicit local Kilo v2 server before any
 * session admission. The probe is the public v2 health contract
 * (`GET /api/health`, Basic auth, `ServiceStatus.Health` with `pid`) runtime
 * decoded through the Protocol schema; a v1 server — whose health lives at
 * `/global/health` with no `pid` and no `/api/health` route — is rejected
 * before a session client is ever exposed, and there is no v1 fallback path.
 * Only Client/Protocol/Schema imports: never Core or Server runtime modules.
 */

export type ConnectV2FailureReason =
  | "loopback"
  | "unauthorized"
  | "incompatible"
  | "unavailable"
  | "malformed"
  | "timeout"

export class ConnectV2Error extends Error {
  constructor(
    readonly reason: ConnectV2FailureReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "ConnectV2Error"
  }
}

export interface ConnectV2Options {
  /** Explicit local server origin. Loopback only; a bare origin with no path, query, or credentials. */
  readonly url: string
  /** The server's explicit password (opencode Basic auth); never read from ambient stores. */
  readonly password: string
  /** Optional caller cancellation; a bounded timeout applies regardless. */
  readonly signal?: AbortSignal
  /** Connection bound in milliseconds; defaults to a fixed bounded window. */
  readonly timeoutMs?: number
}

export interface ConnectV2Result {
  /** The verified public v2 client; safe for session admission. */
  readonly client: OpenCodeClient
  /** The runtime-decoded health payload the verification accepted. */
  readonly health: ServiceStatus.Health
}

const connectTimeoutMs = 10_000
const decodeHealth = Schema.decodeUnknownSync(ServiceStatus.Health)

// Fixed-origin redirect policy for the returned client: a compliant v2 server
// never redirects API routes, and following one could carry the explicit
// credential off the loopback origin.
const fixedOriginFetch: typeof globalThis.fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, { ...init, redirect: "error" }),
  { preconnect: (...args: Parameters<typeof globalThis.fetch.preconnect>) => globalThis.fetch.preconnect(...args) },
)

function loopback(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]"
}

export async function connectV2(options: ConnectV2Options): Promise<ConnectV2Result> {
  let target: URL
  try {
    target = new URL(options.url)
  } catch {
    throw new ConnectV2Error("loopback", `Invalid server URL: ${options.url}`)
  }
  // The v2 host binds loopback only; a non-loopback target is refused before
  // any request, and the explicit credential is never sent off-machine.
  if (
    (target.protocol !== "http:" && target.protocol !== "https:") ||
    !loopback(target) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    (target.pathname !== "/" && target.pathname !== "")
  ) {
    throw new ConnectV2Error(
      "loopback",
      "Server URL must be a bare loopback origin (explicit local Kilo v2 server only)",
    )
  }
  // An already-aborted caller signal is honored before any request.
  if (options.signal?.aborted) {
    throw new ConnectV2Error("timeout", "The connection attempt was cancelled before it started")
  }
  // The bound covers headers, the body read, and the decode: a health server
  // that sends headers and then hangs the body cannot outlive it.
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? connectTimeoutMs)
  const onCallerAbort = () => abort.abort()
  options.signal?.addEventListener("abort", onCallerAbort, { once: true })
  const headers = { authorization: `Basic ${btoa(`opencode:${options.password}`)}` }
  try {
    // redirect: manual — a redirect (opaque for cross-origin) is an explicit
    // refusal instead of silently carrying the credential elsewhere.
    const response = await fetch(new URL("/api/health", target), {
      headers,
      signal: abort.signal,
      redirect: "manual",
    })
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      throw new ConnectV2Error(
        "incompatible",
        "The v2 health endpoint attempted a redirect; a compliant local server never redirects",
      )
    }
    // The pinned v1 server serves health at /global/health with no /api/health
    // route at all, so a route miss here is the v1/unknown rejection.
    if (response.status === 401 || response.status === 403) {
      throw new ConnectV2Error("unauthorized", "The local server rejected the explicit credential")
    }
    if (response.status === 404) {
      throw new ConnectV2Error(
        "incompatible",
        "The server does not expose the v2 health contract; refusing a v1 or unknown server",
      )
    }
    if (response.status !== 200) {
      throw new ConnectV2Error(
        "unavailable",
        `The local Kilo v2 server is not ready (health status ${response.status})`,
      )
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (cause) {
      throw new ConnectV2Error(
        abort.signal.aborted ? "timeout" : "malformed",
        abort.signal.aborted
          ? `Connection to the local Kilo v2 server did not complete within its bound: ${options.url}`
          : "The v2 health response was not valid JSON",
        { cause },
      )
    }
    let health: ServiceStatus.Health
    try {
      health = decodeHealth(body)
    } catch (cause) {
      throw new ConnectV2Error(
        "malformed",
        "The v2 health response did not match the public ServiceStatus.Health schema (a v1 health body has no pid)",
        { cause },
      )
    }
    return {
      client: OpenCode.make({ baseUrl: target.origin, headers, fetch: fixedOriginFetch }),
      health,
    }
  } catch (cause) {
    if (cause instanceof ConnectV2Error) throw cause
    throw new ConnectV2Error(
      abort.signal.aborted ? "timeout" : "unavailable",
      `Connection to the local Kilo v2 server did not complete within its bound: ${options.url}`,
      { cause },
    )
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", onCallerAbort)
  }
}
