export * as KiloResourceToken from "./resource-token.js"

import { Effect, Option, Schema } from "effect"
import { KiloHeaders } from "./headers.js"
import { json, request } from "./http.js"
import { KiloServer } from "./server.js"

export type Resource = "pages" | "pages-dev"

export interface Minted {
  readonly token: string
  /** Epoch milliseconds, from the response. The lifetime is the smaller of 300 s and the account token's remaining life. */
  readonly expiresAt: number
}

export type Refusal =
  | "needs_login"
  | "organization_credential"
  | "credential_type"
  | "blocked"
  | "kilo_disabled"
  | "server"

export type Failure =
  | { readonly kind: "refused"; readonly reason: Refusal; readonly status: number }
  | { readonly kind: "transient"; readonly status?: number; readonly retryAfter?: number }

const Response = Schema.Struct({ token: Schema.String, expiresAt: Schema.String })
const decode = Schema.decodeUnknownOption(Response)

// Mints a short-lived token for a resource server from the user's Kilo account token. The call must not carry the
// organization header: the endpoint refuses any organization context, so a team selection would turn a personal
// sign-in into a 403. The response body never appears in an error, so a failure cannot leak a token.
export function mint(input: {
  readonly server: string
  readonly token: string
  readonly resource: Resource
  readonly version: string
}): Effect.Effect<Minted, Failure> {
  return Effect.gen(function* () {
    const response = yield* request(
      KiloServer.apiUrl(input.server, "auth", "resource-token"),
      {
        method: "POST",
        redirect: "error",
        headers: {
          ...KiloHeaders.request({ version: input.version }),
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ resource: input.resource }),
      },
      "Resource token request failed",
    ).pipe(Effect.mapError((): Failure => ({ kind: "transient" })))
    const body = yield* json(response, "Resource token request failed").pipe(
      Effect.orElseSucceed((): unknown => undefined),
    )
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"))
      return yield* Effect.fail(
        classify(response.status, body, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined),
      )
    }
    const parsed = decode(body)
    const expiresAt = Option.isSome(parsed) ? Date.parse(parsed.value.expiresAt) : Number.NaN
    if (Option.isNone(parsed) || !parsed.value.token || Number.isNaN(expiresAt))
      return yield* Effect.fail<Failure>({ kind: "refused", reason: "server", status: response.status })
    return { token: parsed.value.token, expiresAt }
  })
}

// The status decides; the message only splits the 403 and 503 cases, and unknown text falls back to the generic
// reason of the status, so a reworded message degrades instead of misclassifying.
export function classify(status: number, body: unknown, retryAfter?: number): Failure {
  const message = text(body)
  if (status === 401) return { kind: "refused", reason: "needs_login", status }
  if (status === 403) {
    if (message.includes("organization credentials")) return { kind: "refused", reason: "organization_credential", status }
    if (message.includes("credential context") || message.includes("scoped credentials"))
      return { kind: "refused", reason: "credential_type", status }
    return { kind: "refused", reason: "blocked", status }
  }
  if (status === 503 && message.includes("migration")) return { kind: "refused", reason: "kilo_disabled", status }
  if (status === 408 || status === 429 || status >= 500)
    return { kind: "transient", status, ...(retryAfter ? { retryAfter } : {}) }
  return { kind: "refused", reason: "server", status }
}

function text(body: unknown) {
  if (!body || typeof body !== "object" || !("error" in body) || typeof body.error !== "string") return ""
  return body.error.toLowerCase()
}
