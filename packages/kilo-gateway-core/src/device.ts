export * as KiloDevice from "./device.js"

import { Clock, Effect, Option, Schema } from "effect"
import { json, request, TIMEOUT } from "./http.js"
import { KiloProfile } from "./profile.js"

export const POLL_INTERVAL = 3000
const MAX_BACKOFF = 30_000

/** v1 has no token refresh. The token is valid for one year. */
export const TOKEN_LIFETIME = 365 * 24 * 60 * 60 * 1000

const Code = Schema.Struct({
  code: Schema.String,
  verificationUrl: Schema.String,
  expiresIn: Schema.Number,
})
export type Code = typeof Code.Type

const Poll = Schema.Struct({
  status: Schema.Literals(["pending", "approved", "denied", "expired"]),
  token: Schema.optional(Schema.String),
  userEmail: Schema.optional(Schema.String),
})

export interface Login {
  readonly token: string
  readonly email: string
  /** `null` is the personal account. */
  readonly organizationID: string | null
}

/** Creates a device authorization code that the user approves in the browser. */
export function start(server: string) {
  return Effect.gen(function* () {
    const response = yield* request(`${server}/api/device-auth/codes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
    if (response.status === 429)
      return yield* Effect.fail(new Error("Too many pending authorization requests. Please try again later."))
    if (!response.ok) return yield* Effect.fail(new Error(`Failed to initiate device authorization: ${response.status}`))
    const code = yield* json(response, Code)
    // The URL is shown as a link and opened in a browser.
    if (!/^https?:\/\//.test(code.verificationUrl))
      return yield* Effect.fail(new Error(`Invalid device verification URL: ${code.verificationUrl}`))
    return code
  })
}

/**
 * Polls until the user approves the code, then selects the default team from the profile.
 * Interrupting the effect stops polling.
 */
export function login(server: string, code: Code, interval = POLL_INTERVAL) {
  return Effect.gen(function* () {
    const approved = yield* poll(server, code, (yield* Clock.currentTimeMillis) + code.expiresIn * 1000, interval)
    // Same as v1: a failed profile request does not fail the login. The account then starts on the personal account.
    const profile = yield* KiloProfile.get(server, approved.token).pipe(Effect.option)
    return {
      token: approved.token,
      email: approved.email,
      organizationID: Option.match(profile, { onNone: () => null, onSome: KiloProfile.defaultOrganizationID }),
    } satisfies Login
  })
}

// `delay` is the wait before the next poll. It doubles after each failed request, up to MAX_BACKOFF.
function poll(
  server: string,
  code: Code,
  deadline: number,
  interval: number,
  delay = interval,
): Effect.Effect<{ token: string; email: string }, Error> {
  return Effect.gen(function* () {
    const remaining = deadline - (yield* Clock.currentTimeMillis)
    if (remaining <= 0) return yield* Effect.fail(new Error("Authorization code expired"))
    const response = yield* request(
      `${server}/api/device-auth/codes/${encodeURIComponent(code.code)}`,
      undefined,
      Math.min(TIMEOUT, remaining),
    ).pipe(Effect.option)
    // A network failure, a timeout or a temporary server error must not end a login that the user may
    // still approve. Unlike v1, retry with backoff until the code expires.
    if (Option.isNone(response) || retryable(response.value.status)) {
      yield* Effect.sleep(Math.min(delay, remaining))
      return yield* poll(server, code, deadline, interval, Math.min(delay * 2, MAX_BACKOFF))
    }
    if (response.value.status === 403) return yield* Effect.fail(new Error("Authorization denied by user"))
    if (response.value.status === 410) return yield* Effect.fail(new Error("Authorization code expired"))
    if (!response.value.ok)
      return yield* Effect.fail(new Error(`Failed to poll device authorization: ${response.value.status}`))
    const result = response.value.status === 202 ? { status: "pending" as const } : yield* json(response.value, Poll)
    if (result.status === "denied") return yield* Effect.fail(new Error("Authorization denied by user"))
    if (result.status === "expired") return yield* Effect.fail(new Error("Authorization code expired"))
    if (result.status === "approved") {
      if (!result.token || !result.userEmail) return yield* Effect.fail(new Error("Invalid Kilo response"))
      return { token: result.token, email: result.userEmail }
    }
    yield* Effect.sleep(Math.min(interval, remaining))
    return yield* poll(server, code, deadline, interval)
  })
}

function retryable(status: number) {
  return status === 408 || status === 429 || status >= 500
}
