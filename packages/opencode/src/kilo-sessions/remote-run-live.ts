// kilocode_change - Slice 3A live factory for the sessionless create_and_run
// deep module. This file owns the production wiring (AppRuntime + Effect
// fibers) and lives next to `remote-run.ts` instead of being inlined into
// `kilo-sessions.ts` so the deep module stays pure and testable.
//
// Lifecycle:
//   - createRemoteRunLive({ runtime, attachedState, directory, log, ...
//     optional session/prompt dependencies }) returns a `RemoteRun.Interface`
//     ready to be passed to `RemoteSender.create`.
//   - Session creation runs in the fixed launch-directory Instance via
//     `provide({ directory, fn: () => AppRuntime.runPromise(...) })`.
//   - Prompt persistence + loop installation use the same `provide` wrapper
//     and `AppRuntime.runFork` so the fiber lifetime is owned by the managed
//     `AppRuntime` — the live factory does not manage its own scope, and the
//     loop does NOT auto-close. The prompt-start contract resolves after
//     persistence + fork, not after the full assistant turn.
//   - Late fiber failures (other than interrupt) are sanitized to a fixed
//     `Unknown` error message and published as a `Session.Event.Error` with
//     the error class only — never the prompt, path, token, or raw cause.

import { Cause, Effect } from "effect"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"
import { NamedError } from "@opencode-ai/core/util/error"
import type { SessionID } from "@/session/schema"
import { MessageID } from "@/session/schema"
import { Session } from "@/session/session"
import type { Info as SessionInfo } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { EventV2Bridge } from "@/event-v2-bridge" // kilocode_change - EventV2 publish seam for late-loop-cause errors
import { RemoteRun } from "@/kilo-sessions/remote-run"
import type { RemoteRuntime } from "@/kilo-sessions/remote-runtime"
import type { AttachedState } from "@/kilo-sessions/attached-state"

type Provide = typeof import("@/kilocode/instance").provide

async function provide<R>(input: { directory: string; fn: () => R }): Promise<R> {
  const { provide } = await import("@/kilocode/instance")
  return provide(input)
}

const SAFE_UNKNOWN_MESSAGE = "The session encountered an unexpected error."
const LATE_CAUSE_OPERATION = "remote_run_late_cause"

/**
 * Production-default `publishSessionError` implementation. Yields the
 * `EventV2Bridge.Service` from the surrounding AppRuntime layer and
 * publishes a sanitized `Session.Event.Error` with a fixed `Unknown`
 * message — never the prompt, path, token, or raw cause.
 */
function defaultPublishSessionError(input: {
  sessionID: SessionID
}): Effect.Effect<void, never, EventV2Bridge.Service> {
  return Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    yield* events.publish(Session.Event.Error, {
      sessionID: input.sessionID,
      error: new NamedError.Unknown({ message: SAFE_UNKNOWN_MESSAGE }).toObject(),
    })
  })
}

/**
 * Minimal seam over the production AppRuntime so focused tests can swap a
 * deterministic implementation without pulling in the full Effect runtime.
 * Production callers should pass the real `AppRuntime` from
 * `@/effect/app-runtime`.
 */
export type PublishSessionError = (input: {
  sessionID: SessionID
}) => Effect.Effect<void, never, EventV2Bridge.Service>

export type RuntimeDeps = {
  readonly provide?: Provide
  readonly AppRuntime: {
    runPromise: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>
    runFork: <A, E, R>(effect: Effect.Effect<A, E, R>) => void
  }
  /**
   * Late-loop-cause hook. Production wires a no-op by default. Tests can
   * observe whether a cause is being swallowed/published.
   */
  readonly onLateCause?: (input: {
    operation: string
    sessionID: SessionID
    errorClass: string
  }) => void
  /**
   * Publish seam for the sanitized late-loop-cause event. Production
   * publishes through `EventV2Bridge` (see `defaultPublishSessionError`).
   * Tests inject a stub to observe the published event without standing
   * up a real EventV2 layer.
   */
  readonly publishSessionError: PublishSessionError
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name
  return typeof error
}

/**
 * Returns true when the late cause is the well-known user-cancellation /
 * interrupt signal. Interrupt causes are intentionally swallowed: the prompt
 * may legitimately be cancelled by the user after persistence, and that is
 * not a `Session.Event.Error` case.
 */
function isInterruptCause(cause: Cause.Cause<unknown>): boolean {
  if (Cause.hasInterruptsOnly(cause)) return true
  const failure = cause.reasons.find(Cause.isFailReason)
  if (failure) {
    const value = failure.error as { name?: string; _tag?: string }
    if (
      value &&
      (value.name === "SessionPrompt.InterruptedError" || value._tag === "SessionPrompt.InterruptedError")
    ) {
      return true
    }
  }
  return false
}

export function createRemoteRunLive(options: {
  runtime: RemoteRuntime.Interface
  attachedState: AttachedState.Interface
  directory: string
  log: {
    error: (msg: string, meta?: unknown) => void
    warn: (msg: string, meta?: unknown) => void
  }
  /**
   * Override of the production wiring. Defaults to the real `AppRuntime` +
   * `Instance.provide` from `@/effect/app-runtime` and `@/kilocode/instance`.
   */
  deps?: Partial<RuntimeDeps>
  /**
   * Override of the session-create seam. Defaults to
   * `Session.Service.create({})` in the fixed launch-directory Instance.
   */
  sessionCreate?: (input?: Record<string, never>) => Promise<SessionInfo>
  /**
   * Override of the prompt-persistence + loop-install seam. Defaults to
   * `SessionPrompt.Service.prompt(...)` followed by
   * `AppRuntime.runFork(SessionPrompt.Service.loop(...))`.
   */
  promptStart?: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    variant?: string
    prompt: string
  }) => Promise<{ messageID: string; loopInstalled: boolean }>
}): RemoteRun.Interface {
  const deps: RuntimeDeps = {
    provide: options.deps?.provide,
    AppRuntime: options.deps?.AppRuntime ?? defaultAppRuntime(),
    onLateCause: options.deps?.onLateCause,
    publishSessionError: options.deps?.publishSessionError ?? defaultPublishSessionError,
  }
  const provideFn: Provide = deps.provide ?? provide

  const sessionCreate =
    options.sessionCreate ??
    (async (_input?: Record<string, never>) => {
      return provideFn({
        directory: options.directory,
        fn: () => deps.AppRuntime.runPromise(Session.Service.use((svc) => svc.create({}))),
      })
    })

  const promptStart =
    options.promptStart ??
    (async (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      variant?: string
      prompt: string
    }) => {
      return provideFn({
        directory: options.directory,
        fn: async () => {
          const messageID = MessageID.ascending()
          await deps.AppRuntime.runPromise(
            SessionPrompt.Service.use((svc) =>
              svc.prompt({
                sessionID: input.sessionID,
                messageID,
                noReply: true,
                agent: input.agent,
                model: { providerID: input.model.providerID, modelID: input.model.modelID },
                ...(input.variant ? { variant: input.variant } : {}),
                parts: [{ type: "text" as const, text: input.prompt }],
              }),
            ),
          )
          // After the message is persisted, install the assistant-loop fiber
          // in the managed AppRuntime scope. The fiber is intentionally
          // detached (runFork, not runPromise) so the call returns after
          // installation rather than after the assistant turn.
          deps.AppRuntime.runFork(
            SessionPrompt.Service.use((svc) => svc.loop({ sessionID: input.sessionID })).pipe(
              Effect.catchCause((cause) => {
                if (isInterruptCause(cause)) return Effect.void
                const errorClass = describeCause(cause)
                options.log.error("remote_run late cause", {
                  operation: LATE_CAUSE_OPERATION,
                  sessionID: input.sessionID,
                  error: errorClass,
                })
                deps.onLateCause?.({
                  operation: LATE_CAUSE_OPERATION,
                  sessionID: input.sessionID,
                  errorClass,
                })
                // Publish the sanitized error via the EventV2 seam. The
                // default implementation yields `EventV2Bridge.Service` from
                // the surrounding AppRuntime layer; tests inject a stub.
                return Effect.gen(function* () {
                  yield* deps.publishSessionError({ sessionID: input.sessionID })
                })
              }),
            ),
          )
          return { messageID, loopInstalled: true }
        },
      })
    })

  return RemoteRun.create({
    runtime: options.runtime,
    state: options.attachedState,
    session: { create: sessionCreate },
    prompt: { start: promptStart },
    log: options.log,
  })
}

function defaultAppRuntime(): RuntimeDeps["AppRuntime"] {
  // Lazy import to avoid cycles with `@/effect/app-runtime` at module load.
  return {
    runPromise: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      import("@/effect/app-runtime").then((mod) => mod.AppRuntime.runPromise(effect as never) as Promise<A>),
    runFork: <A, E, R>(effect: Effect.Effect<A, E, R>) => {
      void import("@/effect/app-runtime").then((mod) => mod.AppRuntime.runFork(effect as never))
    },
  }
}

function describeCause(cause: Cause.Cause<unknown>): string {
  const fail = cause.reasons.find(Cause.isFailReason)
  if (fail) return errorName(fail.error)
  if (cause.reasons.some(Cause.isDieReason)) return "Die"
  if (cause.reasons.some(Cause.isInterruptReason)) return "Interrupt"
  return "Unknown"
}
