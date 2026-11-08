// Telemetry for explicit MCP sign-ins (`MCP.authenticate`), the path every Kilo client uses.
//
// One admitted call is one attempt: `MCP Auth Started` when it begins and exactly one
// `MCP Auth Completed` when it settles. The shared runtime records phase changes through
// `Current`, a fiber-local reference that is undefined outside an observed attempt, so the
// marks are no-ops for automatic connects and the two-step start/callback API.
//
// Events never carry server names, URLs, headers, OAuth state, codes, tokens, or raw errors.
// A server is identified only when its effective config matches a public marketplace method.

import { Cause, Context, Effect, Exit } from "effect"
import { Telemetry, type McpAuthCompletedProperties } from "@kilocode/kilo-telemetry"
import * as Log from "@opencode-ai/core/util/log"
import { fetchMcps } from "../marketplace/api"
import { buildMcpEntry } from "../marketplace/mcp-entry"
import type { McpMarketplaceItem } from "../marketplace/schema"
import * as KiloOAuthCallback from "../mcp-oauth-callback"

const VERSION = 1
const log = Log.create({ service: "mcp.auth-telemetry" })

type Props = McpAuthCompletedProperties
type Phase = Props["phase"]
type Outcome = Props["outcome"]

export type Attribution = Pick<
  Props,
  "attribution" | "itemType" | "itemId" | "methodId" | "methodName" | "oauthRequirement" | "authHandler"
>
type Settled = Pick<
  Props,
  | "schemaVersion"
  | "attemptId"
  | "external"
  | "outcome"
  | "phase"
  | "oauthOutcome"
  | "connectionOutcome"
  | "errorCode"
  | "redirect"
  | "durationMs"
>

/** The effective config of the server being signed in to. Used locally only. */
export type Server = { type: string; url?: string; oauth?: unknown } | undefined

type Result = { status: string }
type Options = { external?: boolean }
type Callback = { ok: true } | { ok: false; error: Error }

type Attempt = {
  id: string
  started: number
  external: boolean
  phase: Phase
  redirect: boolean
  oauth: Props["oauthOutcome"]
  /** Terminal category decided before the call returns (denial, cancellation, ...). */
  outcome?: Outcome
  code?: string
  /** Config problem known up front; explains a failure while preparing the flow. */
  setup?: string
  done: boolean
}

const Current = Context.Reference<Attempt | undefined>("~kilo/McpAuthAttempt", {
  defaultValue: () => undefined,
})

// Standard OAuth 2.0 / RFC 7591 error codes. Anything else is reported as `oauth_error`.
const PROTOCOL = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "access_denied",
  "server_error",
  "temporarily_unavailable",
  "unsupported_response_type",
  "unsupported_token_type",
  "invalid_token",
  "invalid_client_metadata",
  "invalid_redirect_uri",
  "insufficient_scope",
  "invalid_target",
  "too_many_requests",
])

const REQUIREMENTS = new Set(["required", "optional", "conditional", "not_required", "unknown"])
const HANDLERS = new Set(["kilo", "server_process", "external_setup", "unknown"])

function protocol(value: unknown) {
  if (typeof value !== "string") return undefined
  return PROTOCOL.has(value) ? value : "oauth_error"
}

/** Map an error to an allowlisted category. Never returns the error text. */
export function classify(error: unknown): string {
  if (!(error instanceof Error)) return "unknown"
  if ("oauthError" in error) return protocol(error.oauthError) ?? "oauth_error"
  if ("errorCode" in error) return protocol(error.errorCode) ?? "oauth_error"
  if (error.name === "UnauthorizedError") return "unauthorized"
  return "unknown"
}

export function setup(server: Server) {
  if (!server) return "server_not_found"
  if (server.type !== "remote") return "unsupported_transport"
  if (server.oauth === false) return "oauth_disabled"
  if (!server.url || !URL.canParse(server.url)) return "invalid_configuration"
  return undefined
}

function update(patch: Partial<Attempt>) {
  return Effect.gen(function* () {
    const attempt = yield* Current
    if (attempt && !attempt.done) Object.assign(attempt, patch)
  })
}

/** The flow was prepared: either a browser redirect is needed, or the server connected without one. */
export function redirect(needed: boolean) {
  return update({ redirect: needed, phase: needed ? "callback_setup" : "tool_discovery" })
}

export function phase(next: Phase) {
  return update({ phase: next })
}

export function fail(code: string) {
  return update({ code })
}

/** Classify the browser callback. A matched code moves on to the token exchange. */
export function callback(result: Callback) {
  if (result.ok) return update({ phase: "token_exchange" })
  const error = result.error
  if (KiloOAuthCallback.isReplaced(error) || KiloOAuthCallback.isDisplaced(error)) return superseded()
  if (KiloOAuthCallback.isCancelled(error))
    return update({ outcome: "cancelled", code: "user_cancelled", oauth: "not_reached" })
  if (KiloOAuthCallback.isExpired(error))
    return update({ outcome: "timeout", code: "callback_timeout", oauth: "failure" })
  if (KiloOAuthCallback.isStopped(error))
    return update({ outcome: "interrupted", code: "callback_stopped", oauth: "not_reached" })
  const code = classify(error)
  if (code === "access_denied") return update({ outcome: "denied", code, oauth: "failure" })
  return update({ outcome: "failure", code, oauth: "failure" })
}

export function superseded() {
  return update({ outcome: "superseded", code: "superseded", oauth: "not_reached" })
}

export function exchange(error: unknown) {
  return update({ code: classify(error), oauth: "failure" })
}

/**
 * Record the result of committing this attempt's credentials. Success requires tokens from
 * this attempt's exchange; stored credentials from an earlier sign-in never count.
 */
export function persisted(provider: { tokens(): Promise<unknown> } | undefined) {
  return Effect.gen(function* () {
    const attempt = yield* Current
    if (!attempt || attempt.done) return
    const tokens = provider ? yield* Effect.promise(() => provider.tokens()) : undefined
    Object.assign(attempt, {
      phase: "reconnect",
      oauth: tokens ? "success" : "failure",
      code: tokens ? undefined : "no_tokens",
    } satisfies Partial<Attempt>)
  })
}

function connection(status: string): Props["connectionOutcome"] {
  if (status === "connected" || status === "needs_auth" || status === "needs_client_registration") return status
  return "failed"
}

function reason(status: string, phase: Phase) {
  if (status === "needs_client_registration") return "registration_required"
  if (status === "needs_auth") return "needs_auth"
  if (phase === "tool_discovery") return "tool_discovery_failed"
  if (phase === "reconnect") return "connection_failed"
  return "unknown"
}

function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "_tag" in error && error._tag === "MCP.NotFoundError"
}

/** Turn the attempt state and the call's exit into the terminal event properties. */
function settle(attempt: Attempt, exit: Exit.Exit<Result, unknown>): Settled {
  const base = {
    schemaVersion: VERSION,
    attemptId: attempt.id,
    external: attempt.external,
    redirect: attempt.redirect,
    durationMs: Date.now() - attempt.started,
  }

  if (Exit.isFailure(exit)) {
    if (Cause.hasInterruptsOnly(exit.cause)) {
      return {
        ...base,
        outcome: "interrupted",
        phase: attempt.phase,
        oauthOutcome: attempt.oauth,
        connectionOutcome: "not_attempted",
        errorCode: "interrupted",
      }
    }
    const error = Cause.squash(exit.cause)
    // The config can also disappear later, for example while the browser step is open; the
    // phase and OAuth result already recorded for this attempt still stand.
    const code = (() => {
      if (isNotFound(error)) return "server_not_found"
      if (attempt.phase === "credential_store") return "credential_store_failed"
      if (attempt.phase === "prepare") return attempt.setup ?? classify(error)
      return attempt.code ?? classify(error)
    })()
    const oauth = (() => {
      if (attempt.oauth === "success") return attempt.oauth
      if (!attempt.redirect && attempt.phase !== "prepare") return "not_performed"
      if (attempt.phase === "token_exchange" || attempt.phase === "credential_store") return "failure"
      if (attempt.phase === "prepare" && PROTOCOL.has(code)) return "failure"
      return "not_reached"
    })()
    return {
      ...base,
      outcome: "failure",
      phase: attempt.phase,
      oauthOutcome: oauth,
      connectionOutcome:
        attempt.phase === "reconnect" || attempt.phase === "tool_discovery" ? "failed" : "not_attempted",
      errorCode: code,
    }
  }

  if (attempt.outcome) {
    return {
      ...base,
      outcome: attempt.outcome,
      phase: attempt.phase,
      oauthOutcome: attempt.oauth,
      connectionOutcome: "not_attempted",
      ...(attempt.code && { errorCode: attempt.code }),
    }
  }

  const status = exit.value.status
  const oauth = attempt.redirect ? attempt.oauth : "not_performed"
  if (status === "connected") {
    return {
      ...base,
      outcome: "success",
      phase: attempt.phase,
      oauthOutcome: oauth,
      connectionOutcome: "connected",
    }
  }
  return {
    ...base,
    outcome: "failure",
    phase: attempt.phase,
    oauthOutcome: oauth,
    connectionOutcome:
      attempt.phase === "reconnect" || attempt.phase === "tool_discovery" ? connection(status) : "not_attempted",
    errorCode: attempt.code ?? reason(status, attempt.phase),
  }
}

// --- Marketplace attribution -------------------------------------------------------------

const UNKNOWN: Attribution = { attribution: "unknown" }

function allow(value: string | undefined, set: Set<string>) {
  if (!value) return undefined
  return set.has(value) ? value : "unknown"
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// A catalog URL can contain install parameters (`{{TENANT}}`, `${TENANT}`); each one matches
// a single URL segment so a template never matches an unrelated host or path.
function pattern(template: string) {
  const parts = template.split(/\{\{[^}]+\}\}|\$\{[^}]+\}/)
  return new RegExp(`^${parts.map(escape).join("[^/?#&]+")}$`)
}

function remote(content: string) {
  const entry = (() => {
    try {
      return buildMcpEntry(content)
    } catch (err) {
      // Templates with unquoted parameters only parse after substitution; they cannot match.
      log.debug("catalog method is not parseable without parameters", { err })
      return undefined
    }
  })()
  if (!entry || entry.type !== "remote" || typeof entry.url !== "string") return undefined
  return entry.url
}

/**
 * Verify a configured server against the public catalog. The config key must equal the
 * catalog ID (the installer writes it that way) and the configured URL must match one of the
 * item's installation methods. A name alone is never enough.
 */
export function match(items: readonly McpMarketplaceItem[], name: string, url: string): Attribution {
  const item = items.find((entry) => entry.id === name)
  if (!item) return UNKNOWN
  const methods =
    typeof item.content === "string"
      ? [
          {
            id: "default",
            name: undefined,
            content: item.content,
            oauthRequirement: item.oauthRequirement,
            authHandler: item.authHandler,
          },
        ]
      : item.content
  const hits = methods.filter((method) => {
    const template = remote(method.content)
    return template !== undefined && pattern(template).test(url)
  })
  if (hits.length === 0) return UNKNOWN
  // Several methods can share one URL; the item is still verified, the method is not.
  const hit = hits.length === 1 ? hits[0] : undefined
  return {
    attribution: "verified",
    itemType: "mcp",
    itemId: item.id,
    ...(hit?.id && { methodId: hit.id }),
    ...(hit?.name && { methodName: hit.name }),
    ...(hit?.oauthRequirement && { oauthRequirement: allow(hit.oauthRequirement, REQUIREMENTS) }),
    ...(hit?.authHandler && { authHandler: allow(hit.authHandler, HANDLERS) }),
  }
}

/** Resolve attribution in the background; it never delays or fails the sign-in. */
export function attribute(name: string, server: Server): Promise<Attribution> {
  if (!Telemetry.isEnabled()) return Promise.resolve(UNKNOWN)
  // A custom catalog is not public marketplace identity.
  if (process.env["KILO_MARKETPLACE_BASE_URL"]) return Promise.resolve(UNKNOWN)
  const url = server?.type === "remote" ? server.url : undefined
  if (!url) return Promise.resolve(UNKNOWN)
  return fetchMcps()
    .then((items) => match(items, name, url))
    .catch((err: unknown) => {
      log.warn("marketplace attribution failed", { err })
      return UNKNOWN
    })
}

// --- Wrapper -----------------------------------------------------------------------------

// Attribution starts with the attempt and is normally resolved long before a browser sign-in
// ends. A fast exit waits at most this long so short-lived processes (`kilo mcp auth`) queue
// the terminal event before telemetry shuts down; a slow catalog falls back to `unknown`.
const ATTRIBUTION_WAIT = 1_000

function bounded(attribution: Promise<Attribution>) {
  const wait = Promise.withResolvers<Attribution>()
  const timer = setTimeout(() => wait.resolve(UNKNOWN), ATTRIBUTION_WAIT)
  timer.unref?.()
  return Promise.race([attribution, wait.promise]).finally(() => clearTimeout(timer))
}

async function emit(attempt: Attempt, exit: Exit.Exit<Result, unknown>, attribution: Promise<Attribution>) {
  if (attempt.done) return
  attempt.done = true
  const props = settle(attempt, exit)
  const attr = await bounded(attribution)
  try {
    Telemetry.trackMcpAuthCompleted({ ...props, ...attr })
  } catch (err) {
    log.warn("mcp auth telemetry failed", { err })
  }
}

/**
 * Observe `MCP.authenticate`. `lookup` returns the effective server config so the attempt can
 * name config problems and verify marketplace identity; it never changes the sign-in result.
 */
export function observe<A extends Result, E, R, R2>(
  run: (name: string, onAuthorization?: (url: string) => void, opts?: Options) => Effect.Effect<A, E, R>,
  lookup: (name: string) => Effect.Effect<Server, unknown, R2>,
) {
  return (name: string, onAuthorization?: (url: string) => void, opts?: Options) =>
    Effect.gen(function* () {
      // A lookup failure only loses context, but any interrupt, even mixed with a failure, must
      // still abort the sign-in before an attempt is recorded.
      const server = yield* lookup(name).pipe(
        Effect.catchCause((cause) => (Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed(undefined))),
      )
      const attempt: Attempt = {
        id: crypto.randomUUID(),
        started: Date.now(),
        external: opts?.external === true,
        phase: "prepare",
        redirect: false,
        oauth: "not_reached",
        setup: setup(server),
        done: false,
      }
      const attribution = attribute(name, server)
      // Sending the started event and attaching the completion are one uninterruptible step:
      // only the sign-in itself can be interrupted, so every started event gets its completion.
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* Effect.try({
            try: () =>
              Telemetry.trackMcpAuthStarted({
                schemaVersion: VERSION,
                attemptId: attempt.id,
                external: attempt.external,
              }),
            catch: (err) => err,
          }).pipe(
            Effect.tapError((err) => Effect.logWarning("mcp auth telemetry failed", { err })),
            Effect.ignore,
          )
          return yield* restore(run(name, onAuthorization, opts).pipe(Effect.provideService(Current, attempt))).pipe(
            // Queue the terminal event before the caller sees the result; never fails the sign-in.
            Effect.onExit((exit) => Effect.promise(() => emit(attempt, exit, attribution))),
          )
        }),
      )
    })
}
