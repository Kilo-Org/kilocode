export * as PagesToken from "./token"

import { createHash } from "node:crypto"
import { KiloResourceToken, type KiloAccount } from "@kilocode/gateway-core"
import { Effect, Redacted } from "effect"

// A Pages deployment and the Kilo resource whose tokens it accepts. Kilo mints a token for one resource and the
// deployment trusts only its own audience, so the pair lives here and nowhere else: the token is sent to this origin
// and to no other.
export interface Deployment {
  readonly origin: string
  readonly resource: KiloResourceToken.Resource
}

export const DEPLOYMENTS: readonly Deployment[] = [
  { origin: "https://pages-dev.kiloapps.io", resource: "pages-dev" },
  { origin: "https://pages.kiloapps.io", resource: "pages" },
]

// `pages.kiloapps.io` does not resolve yet, so the development deployment is the one that serves Kilo tokens.
export const DEFAULT = DEPLOYMENTS[0]!

// A token is replaced a little before it expires, so a request never reaches Pages with one it already treats as expired.
const SKEW_MS = 60_000
// One forced re-mint per window, so a Pages that keeps answering 401 cannot drive a mint loop.
const FORCE_WINDOW_MS = 30_000
const FLAG_RETRY_MS = 10 * 60_000
const IDLE_MS = 60 * 60_000

type Slot = {
  token?: { readonly value: string; readonly expiresAt: number }
  inflight?: Promise<Result>
  refused?: { readonly failure: KiloResourceToken.Failure & { readonly kind: "refused" }; readonly until?: number }
  backoff?: { readonly attempt: number; readonly retryAt: number; readonly failure: KiloResourceToken.Failure }
  forcedAt?: number
  touched: number
}

type Result = { readonly ok: true; readonly minted: KiloResourceToken.Minted } | { readonly ok: false; readonly failure: KiloResourceToken.Failure }

// Process-global, like the other per-process Kilo registries: every Location on one credential shares a token and an
// in-flight mint. The organization is not part of the key because the mint carries none.
const slots = new Map<string, Slot>()

export type Entry =
  | { readonly kind: "none" }
  | { readonly kind: "valid"; readonly expiresAt: number }
  | { readonly kind: "refused"; readonly failure: KiloResourceToken.Failure }
  | { readonly kind: "backoff"; readonly retryAt: number }

export function key(account: Pick<KiloAccount.Info, "server" | "token">, deployment: Deployment) {
  return `${account.server}\n${deployment.resource}\n${createHash("sha256").update(account.token).digest("hex")}`
}

export function get(input: {
  readonly account: Pick<KiloAccount.Info, "server" | "token">
  readonly deployment: Deployment
  readonly version: string
  /** A token Pages refused. Forces one re-mint when it is still the cached token. */
  readonly rejected?: string
}): Effect.Effect<Redacted.Redacted<string>, KiloResourceToken.Failure> {
  return Effect.suspend(() => {
    const now = Date.now()
    prune(now)
    const id = key(input.account, input.deployment)
    const slot = slots.get(id) ?? { touched: now }
    slots.set(id, slot)
    slot.touched = now

    if (slot.refused && (slot.refused.until === undefined || slot.refused.until > now))
      return Effect.fail<KiloResourceToken.Failure>(slot.refused.failure)
    if (slot.backoff && slot.backoff.retryAt > now) return Effect.fail(slot.backoff.failure)

    if (input.rejected !== undefined && slot.token?.value === input.rejected) {
      slot.token = undefined
      if (slot.forcedAt !== undefined && now - slot.forcedAt < FORCE_WINDOW_MS)
        return Effect.fail<KiloResourceToken.Failure>({ kind: "refused", reason: "needs_login", status: 401 })
      slot.forcedAt = now
    }

    if (slot.token && slot.token.expiresAt - SKEW_MS > now) return Effect.succeed(Redacted.make(slot.token.value))

    slot.inflight ??= Effect.runPromise(
      KiloResourceToken.mint({
        server: input.account.server,
        token: input.account.token,
        resource: input.deployment.resource,
        version: input.version,
      }).pipe(
        Effect.match({
          onSuccess: (minted): Result => ({ ok: true, minted }),
          onFailure: (failure): Result => ({ ok: false, failure }),
        }),
      ),
    ).then((result) => {
      // A newer mint for the same key cannot exist while this one is in flight, so installing the result is safe.
      slot.inflight = undefined
      install(slot, result)
      return result
    })
    return Effect.promise(() => slot.inflight!).pipe(
      Effect.flatMap((result) =>
        result.ok ? Effect.succeed(Redacted.make(result.minted.token)) : Effect.fail(result.failure),
      ),
    )
  })
}

function install(slot: Slot, result: Result) {
  const now = Date.now()
  if (result.ok) {
    slot.token = { value: result.minted.token, expiresAt: result.minted.expiresAt }
    slot.refused = undefined
    slot.backoff = undefined
    return
  }
  slot.token = undefined
  if (result.failure.kind === "refused") {
    slot.refused = {
      failure: result.failure,
      ...(result.failure.reason === "kilo_disabled" ? { until: now + FLAG_RETRY_MS } : {}),
    }
    return
  }
  const attempt = (slot.backoff?.attempt ?? -1) + 1
  const delay = Math.max(Math.min(30 * 2 ** Math.min(attempt, 4), 300), result.failure.retryAfter ?? 0) * 1000
  slot.backoff = { attempt, retryAt: now + delay, failure: result.failure }
}

/** What the cache holds for the key, without any network call. */
export function peek(account: Pick<KiloAccount.Info, "server" | "token">, deployment: Deployment): Entry {
  const slot = slots.get(key(account, deployment))
  const now = Date.now()
  if (!slot) return { kind: "none" }
  if (slot.refused && (slot.refused.until === undefined || slot.refused.until > now))
    return { kind: "refused", failure: slot.refused.failure }
  if (slot.backoff && slot.backoff.retryAt > now) return { kind: "backoff", retryAt: slot.backoff.retryAt }
  if (slot.token && slot.token.expiresAt - SKEW_MS > now) return { kind: "valid", expiresAt: slot.token.expiresAt }
  return { kind: "none" }
}

/** Forget the token and any refusal or backoff, so the next `get` asks Kilo again. */
export function drop(account: Pick<KiloAccount.Info, "server" | "token">, deployment: Deployment) {
  slots.delete(key(account, deployment))
}

/** Forget a refusal or backoff but keep a valid token, for a user's retry. */
export function retry(account: Pick<KiloAccount.Info, "server" | "token">, deployment: Deployment) {
  const slot = slots.get(key(account, deployment))
  if (!slot) return
  slot.refused = undefined
  slot.backoff = undefined
}

function prune(now: number) {
  for (const [id, slot] of slots) if (!slot.inflight && now - slot.touched > IDLE_MS) slots.delete(id)
}

/** Test helper: forget everything. */
export function reset() {
  slots.clear()
}
