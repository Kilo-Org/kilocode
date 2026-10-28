import { createHash } from "node:crypto"
import { Redacted } from "effect"
import z from "zod"
import type { ServiceOrigin } from "./origin"
import { readBoundedJson } from "./response-json"

/**
 * Cloud Agent control-token exchange.
 *
 * The original user source credential is a credential for the Web App issuer,
 * never for the Cloud Agent Worker. Before any Worker read, mutation, or native
 * feed, this module exchanges the source for a short-lived control token at
 * `POST {issuer}/api/cloud-agent-next/token` and returns only the control token
 * to the caller. The source credential is sent to the issuer and is never sent
 * to the Worker.
 */

export const CONTROL_TOKEN_PATH = "/api/cloud-agent-next/token"
export const CONTROL_TOKEN_TIMEOUT_MS = 30_000
export const CONTROL_TOKEN_SKEW_MS = 60_000
export const CONTROL_TOKEN_CACHE_LIMIT = 8
const MAX_CONTROL_TOKEN_RESPONSE_BYTES = 64 * 1024
const MAX_CONTROL_TOKEN_LENGTH = 8192

const ResponseSchema = z.object({
  token: z.string().min(1).max(MAX_CONTROL_TOKEN_LENGTH),
  expiresAt: z.iso.datetime().transform((value) => Date.parse(value)),
})

export type ControlTokenReason = "unauthorized" | "unavailable" | "invalid_response"

export class ControlTokenError extends Error {
  constructor(
    readonly reason: ControlTokenReason,
    message: string,
  ) {
    super(message)
    this.name = "ControlTokenError"
  }
}

export interface ControlToken {
  readonly token: Redacted.Redacted
  readonly expiresAt: number
}

export interface ControlTokenRequest {
  readonly source: Redacted.Redacted
  readonly organizationID?: string
  readonly issuer: ServiceOrigin
  readonly worker: ServiceOrigin
}

export interface ControlTokenClient {
  exchange(request: ControlTokenRequest): Promise<ControlToken>
}

export interface ControlTokenCache {
  get(key: string): ControlToken | undefined
  set(key: string, value: ControlToken): void
  clear(): void
}

export interface ControlTokenClientOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly clock?: () => number
  readonly cache?: ControlTokenCache
  readonly timeoutMs?: number
  readonly skewMs?: number
}

/** A bounded, insertion-ordered cache of issued control tokens. */
export function createControlTokenCache(limit = CONTROL_TOKEN_CACHE_LIMIT): ControlTokenCache {
  const entries = new Map<string, ControlToken>()
  return {
    get: (key) => entries.get(key),
    set(key, value) {
      entries.delete(key)
      entries.set(key, value)
      while (entries.size > limit) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    clear: () => entries.clear(),
  }
}

export function createControlTokenClient(options: ControlTokenClientOptions = {}): ControlTokenClient {
  const fetcher = options.fetch ?? globalThis.fetch
  const clock = options.clock ?? Date.now
  const cache = options.cache ?? createControlTokenCache()
  const timeoutMs = options.timeoutMs ?? CONTROL_TOKEN_TIMEOUT_MS
  const skewMs = options.skewMs ?? CONTROL_TOKEN_SKEW_MS

  return {
    async exchange(request) {
      const key = cacheKey(request)
      const cached = cache.get(key)
      if (cached !== undefined && cached.expiresAt - skewMs > clock()) return cached

      const control = await issue(fetcher, timeoutMs, clock, request)
      if (control.expiresAt - skewMs > clock()) cache.set(key, control)
      return control
    },
  }
}

async function issue(
  fetcher: typeof globalThis.fetch,
  timeoutMs: number,
  clock: () => number,
  request: ControlTokenRequest,
): Promise<ControlToken> {
  const body = JSON.stringify(request.organizationID === undefined ? {} : { organizationId: request.organizationID })
  const url = new URL(CONTROL_TOKEN_PATH, request.issuer)

  let response: Response
  try {
    response = await fetcher(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${Redacted.value(request.source)}`,
        ...(request.organizationID === undefined ? {} : { "x-kilocode-organizationid": request.organizationID }),
      },
      body,
      ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    })
  } catch {
    throw new ControlTokenError("unavailable", "Kilo control token could not be issued")
  }

  const payload = await readBoundedJson(response, MAX_CONTROL_TOKEN_RESPONSE_BYTES).catch(() => undefined)
  if (!response.ok) throw errorForStatus(response.status)
  const parsed = ResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new ControlTokenError("invalid_response", "Kilo control token response is invalid")
  }
  if (parsed.data.expiresAt <= clock()) {
    throw new ControlTokenError("invalid_response", "Kilo control token has already expired")
  }
  return { token: Redacted.make(parsed.data.token), expiresAt: parsed.data.expiresAt }
}

function errorForStatus(status: number) {
  if (status === 401 || status === 403) {
    return new ControlTokenError("unauthorized", "Kilo Cloud denied the control token request")
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new ControlTokenError("unavailable", "Kilo Cloud token issuance is temporarily unavailable")
  }
  return new ControlTokenError(
    "invalid_response",
    `Kilo control token issuer returned an unexpected HTTP status: ${status}`,
  )
}

function cacheKey(request: ControlTokenRequest) {
  return [digest(Redacted.value(request.source)), request.organizationID ?? "", request.issuer, request.worker].join(
    ":",
  )
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
