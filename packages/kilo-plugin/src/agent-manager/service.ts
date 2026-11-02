import { Identifier } from "@opencode/schema/identifier"
import { KiloAgentManagerRpc } from "@opencode/schema/kilocode/agent-manager"
import { Deferred, Duration, Effect, Schema } from "effect"

export type Request = KiloAgentManagerRpc.Request
export type Result = KiloAgentManagerRpc.Result
export type Failure = KiloAgentManagerRpc.Failure

type WithoutID<T> = T extends unknown ? Omit<T, "id"> : never
export type Input = WithoutID<Request>

export class HostError extends Schema.TaggedError<HostError>()("AgentManagerHostError", {
  code: KiloAgentManagerRpc.ErrorCode,
  detail: Schema.String,
}) {
  override get message() {
    return this.detail
  }
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("AgentManager.NotFoundError", {
  requestID: KiloAgentManagerRpc.RequestID,
}) {}

export class InvalidReplyError extends Schema.TaggedError<InvalidReplyError>()("AgentManager.InvalidReplyError", {
  requestID: KiloAgentManagerRpc.RequestID,
}) {}

interface Entry {
  readonly info: Request
  readonly deferred: Deferred.Deferred<Result, HostError>
}

export interface Emit {
  readonly requested: (request: Request) => Effect.Effect<void>
  readonly cancelled: (event: KiloAgentManagerRpc.Cancelled) => Effect.Effect<void>
}

export interface AgentManagerInterface {
  readonly request: (input: Input) => Effect.Effect<Result, HostError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  readonly reply: (input: {
    requestID: KiloAgentManagerRpc.RequestID
    result: Result
  }) => Effect.Effect<void, NotFoundError | InvalidReplyError>
  readonly reject: (input: {
    requestID: KiloAgentManagerRpc.RequestID
    error: Failure
  }) => Effect.Effect<void, NotFoundError>
  /** Ends every pending request, as when the location or the server goes away. */
  readonly dispose: Effect.Effect<void>
}

function matches(request: Request, result: Result) {
  if (request.operation === "overview") return result.operation === "overview"
  if (!("sessionID" in result)) return false
  return result.operation === request.operation && result.sessionID === request.targetSessionID
}

export const createService = Effect.fn("AgentManager.createService")(function* (
  emit: Emit,
  timeout: Duration.Input = "60 seconds",
) {
  const pending = new Map<KiloAgentManagerRpc.RequestID, Entry>()

  const cancel = Effect.fn("AgentManager.cancel")(function* (
    id: KiloAgentManagerRpc.RequestID,
    entry: Entry,
    reason: "cancelled" | "disposed" | "timeout",
  ) {
    if (pending.get(id) !== entry) return
    pending.delete(id)
    yield* emit.cancelled({ requestID: id, sessionID: entry.info.sessionID, reason })
    yield* Deferred.fail(
      entry.deferred,
      new HostError({
        code: reason === "disposed" ? "disconnected" : reason,
        detail:
          reason === "timeout"
            ? "The Agent Manager extension did not reply before the request timeout"
            : reason === "disposed"
              ? "The Agent Manager host disconnected"
              : "The Agent Manager request was cancelled",
      }),
    )
  })

  const request = Effect.fn("AgentManager.request")(function* (input: Input) {
    const id = KiloAgentManagerRpc.RequestID.make(`amr_${Identifier.ascending()}`)
    const deferred = yield* Deferred.make<Result, HostError>()
    // SAFETY: Input is Request without its generated id, so adding the id produces that request variant.
    const info = { ...input, id } as Request
    const entry: Entry = { info, deferred }
    pending.set(id, entry)
    yield* emit.requested(info)
    return yield* Deferred.await(deferred).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () => cancel(id, entry, "timeout").pipe(Effect.andThen(Deferred.await(deferred))),
      }),
      Effect.ensuring(cancel(id, entry, "cancelled")),
    )
  })

  const list = Effect.fn("AgentManager.list")(function* () {
    return Array.from(pending.values(), (entry) => entry.info)
  })

  const reply = Effect.fn("AgentManager.reply")(function* (input: {
    requestID: KiloAgentManagerRpc.RequestID
    result: Result
  }) {
    const entry = pending.get(input.requestID)
    if (!entry) return yield* new NotFoundError({ requestID: input.requestID })
    if (!matches(entry.info, input.result)) return yield* new InvalidReplyError({ requestID: input.requestID })
    pending.delete(input.requestID)
    yield* Deferred.succeed(entry.deferred, input.result)
  })

  const reject = Effect.fn("AgentManager.reject")(function* (input: {
    requestID: KiloAgentManagerRpc.RequestID
    error: Failure
  }) {
    const entry = pending.get(input.requestID)
    if (!entry) return yield* new NotFoundError({ requestID: input.requestID })
    pending.delete(input.requestID)
    yield* Deferred.fail(entry.deferred, new HostError({ code: input.error.code, detail: input.error.message }))
  })

  const dispose = Effect.fn("AgentManager.dispose")(function* () {
    yield* Effect.forEach([...pending.values()], (entry) =>
      Effect.gen(function* () {
        const id = entry.info.id
        yield* cancel(id, entry, "disposed")
      }),
    )
  })

  return { request, list, reply, reject, dispose: dispose() } satisfies AgentManagerInterface
})
