export * as KiloDevice from "./device.js"

import { Effect, Option, Schema } from "effect"
import { json, request } from "./http.js"
import { KiloProfile } from "./profile.js"
import { KiloServer } from "./server.js"

const POLL_INTERVAL_MS = 3_000
const MAX_BACKOFF_MS = 30_000
// v1 sets the OAuth expiry one year ahead because Kilo tokens do not use a refresh flow yet.
export const TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000

const Code = Schema.Struct({
  code: Schema.String,
  verificationUrl: Schema.String,
  expiresIn: Schema.Number,
})

const Poll = Schema.Struct({
  status: Schema.Literals(["pending", "approved", "denied", "expired"]),
  token: Schema.optional(Schema.String),
  userEmail: Schema.optional(Schema.String),
})

export type Code = typeof Code.Type

export interface Login {
  readonly token: string
  readonly email: string
  readonly organizationID: string | null
}

const decodeCode = Schema.decodeUnknownOption(Code)
const decodePoll = Schema.decodeUnknownOption(Poll)

export function start(server: string): Effect.Effect<Code, Error> {
  return Effect.gen(function* () {
    const response = yield* request(
      `${KiloServer.normalize(server)}/api/device-auth/codes`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      "Failed to initiate device authorization",
    )
    if (!response.ok) {
      return yield* Effect.fail(
        new Error(
          response.status === 429
            ? "Too many pending authorization requests. Please try again later."
            : `Failed to initiate device authorization: ${response.status}`,
        ),
      )
    }
    const parsed = decodeCode(yield* json(response, "Failed to initiate device authorization"))
    if (Option.isNone(parsed)) return yield* Effect.fail(new Error("Invalid Kilo response"))
    // The TUI opens this URL in the user's browser; only accept HTTP(S).
    if (!/^https?:\/\//.test(parsed.value.verificationUrl))
      return yield* Effect.fail(new Error(`Invalid device verification URL: ${parsed.value.verificationUrl}`))
    return parsed.value
  })
}

export function login(server: string, code: Code, intervalMs = POLL_INTERVAL_MS): Effect.Effect<Login, Error> {
  return Effect.gen(function* () {
    const approved = yield* poll(KiloServer.normalize(server), code.code, Date.now() + code.expiresIn * 1000, intervalMs, 0)
    const organizationID = yield* KiloProfile.get(server, approved.token).pipe(
      Effect.map(KiloProfile.defaultOrganizationID),
      Effect.orElseSucceed(() => null),
    )
    return { ...approved, organizationID }
  })
}

function poll(
  server: string,
  code: string,
  expiresAt: number,
  intervalMs: number,
  failures: number,
): Effect.Effect<{ token: string; email: string }, Error> {
  return Effect.gen(function* () {
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) return yield* Effect.fail(new Error("Authorization code expired"))
    const wait = (next: number) =>
      Effect.sleep(Math.min(intervalMs * 2 ** Math.min(next, 4), MAX_BACKOFF_MS, Math.max(0, expiresAt - Date.now()))).pipe(
        Effect.andThen(() => poll(server, code, expiresAt, intervalMs, next)),
      )
    const response = yield* request(
      `${server}/api/device-auth/codes/${encodeURIComponent(code)}`,
      { headers: { "Content-Type": "application/json" } },
      "Failed to poll device authorization",
      Math.min(10_000, remaining),
    ).pipe(Effect.option)
    // Network error, timeout, 408, 429 or 5xx: back off and keep polling until the code expires.
    if (Option.isNone(response) || response.value.status === 408 || response.value.status === 429 || response.value.status >= 500) {
      return yield* wait(failures + 1)
    }
    if (response.value.status === 202) return yield* wait(0)
    if (response.value.status === 403) return yield* Effect.fail(new Error("Authorization denied by user"))
    if (response.value.status === 410) return yield* Effect.fail(new Error("Authorization code expired"))
    if (!response.value.ok) {
      return yield* Effect.fail(new Error(`Failed to poll device authorization: ${response.value.status}`))
    }
    const parsed = decodePoll(yield* json(response.value, "Failed to poll device authorization"))
    if (Option.isNone(parsed)) return yield* Effect.fail(new Error("Invalid Kilo response"))
    if (parsed.value.status === "pending") return yield* wait(0)
    if (parsed.value.status === "denied") return yield* Effect.fail(new Error("Authorization denied by user"))
    if (parsed.value.status === "expired") return yield* Effect.fail(new Error("Authorization code expired"))
    if (!parsed.value.token || !parsed.value.userEmail) return yield* Effect.fail(new Error("Invalid Kilo response"))
    return { token: parsed.value.token, email: parsed.value.userEmail }
  })
}
