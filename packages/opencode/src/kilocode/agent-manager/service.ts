import { Bus } from "@/bus"
import { InstanceRef } from "@/effect/instance-ref"
import { registerDisposer } from "@/effect/instance-registry"
import { Identifier } from "@/id/id"
import type { InstanceContext } from "@/project/instance-context"
import * as Log from "@opencode-ai/core/util/log"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Deferred, Duration, Effect, Layer, LayerMap, Schema } from "effect"
import { ErrorCode, Event, type Failure, type Request, RequestID, type Result } from "./protocol"

const log = Log.create({ service: "agent-manager-host" })
type WithoutID<T> = T extends unknown ? Omit<T, "id"> : never
export type Input = WithoutID<Request>

export class HostError extends Schema.TaggedErrorClass<HostError>()("AgentManagerHostError", {
  code: ErrorCode,
  detail: Schema.String,
}) {
  override get message() {
    return this.detail
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("AgentManager.NotFoundError", {
  requestID: RequestID,
}) {}

export class InvalidReplyError extends Schema.TaggedErrorClass<InvalidReplyError>()("AgentManager.InvalidReplyError", {
  requestID: RequestID,
}) {}

interface Entry {
  info: Request
  deferred: Deferred.Deferred<Result, HostError>
}

interface State {
  context: InstanceContext
  closed: boolean
  pending: Map<RequestID, Entry>
  close: () => Effect.Effect<void>
}

class StateService extends Context.Service<StateService, State>()("@kilocode/AgentManager.State") {}

function matches(request: Request, result: Result) {
  if (request.operation === "overview") return result.operation === "overview"
  if (!("sessionID" in result)) return false
  return result.operation === request.operation && result.sessionID === request.targetSessionID
}

export interface Interface {
  readonly request: (input: Input) => Effect.Effect<Result, HostError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  readonly reply: (input: {
    requestID: RequestID
    result: Result
  }) => Effect.Effect<void, NotFoundError | InvalidReplyError>
  readonly reject: (input: { requestID: RequestID; error: Failure }) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/AgentManager") {}

export function layer(timeout: Duration.Input = "60 seconds") {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const active = new Map<string, Set<State>>()
      const states = yield* LayerMap.make(
        (context: InstanceContext) =>
          Layer.effect(
            StateService,
            Effect.gen(function* () {
              const data = {
                context,
                closed: false,
                pending: new Map<RequestID, Entry>(),
              }
              const done = Effect.gen(function* () {
                if (data.closed) return
                data.closed = true
                for (const entry of data.pending.values()) {
                  yield* bus
                    .publish(Event.Cancelled, {
                      requestID: entry.info.id,
                      sessionID: entry.info.sessionID,
                      reason: "disposed",
                    })
                    .pipe(Effect.ignore)
                  yield* Deferred.fail(
                    entry.deferred,
                    new HostError({ code: "disconnected", detail: "The Agent Manager host disconnected" }),
                  )
                }
                data.pending.clear()
              }).pipe(Effect.provideService(InstanceRef, context))
              const state: State = { ...data, close: () => done }
              const current = active.get(context.directory) ?? new Set<State>()
              current.add(state)
              active.set(context.directory, current)
              yield* Effect.addFinalizer(() =>
                done.pipe(
                  Effect.ensuring(
                    Effect.sync(() => {
                      const current = active.get(context.directory)
                      if (!current) return
                      current.delete(state)
                      if (current.size === 0) active.delete(context.directory)
                    }),
                  ),
                ),
              )
              return StateService.of(state)
            }),
          ).pipe(Layer.provide(Layer.succeed(InstanceRef, context))),
        { idleTimeToLive: Duration.infinity },
      )

      const off = registerDisposer(async (directory) => {
        const current = active.get(directory)
        if (!current) return
        await Effect.runPromise(
          Effect.forEach(
            [...current],
            (state) => state.close().pipe(Effect.ensuring(states.invalidate(state.context))),
            { concurrency: "unbounded", discard: true },
          ),
        )
      })
      yield* Effect.addFinalizer(() => Effect.sync(off))

      const state = Effect.fn("AgentManager.state")(function* () {
        const context = yield* InstanceRef
        if (!context) return yield* Effect.die(new Error("Agent Manager instance context not available"))
        return yield* Effect.gen(function* () {
          return yield* StateService
        }).pipe(Effect.provide(states.get(context)))
      })

      const cancel = Effect.fn("AgentManager.cancel")(function* (
        current: State,
        id: RequestID,
        reason: "cancelled" | "timeout",
      ) {
        const pending = current.pending
        const entry = pending.get(id)
        if (!entry) return
        pending.delete(id)
        yield* bus.publish(Event.Cancelled, { requestID: id, sessionID: entry.info.sessionID, reason })
        yield* Deferred.fail(
          entry.deferred,
          new HostError({
            code: reason,
            detail:
              reason === "timeout"
                ? "The Agent Manager extension did not reply before the request timeout"
                : "The Agent Manager request was cancelled",
          }),
        )
      })

      const request: Interface["request"] = Effect.fn("AgentManager.request")(function* (input) {
        const current = yield* state()
        const pending = current.pending
        const id = RequestID.make(Identifier.create("amr", "ascending"))
        const deferred = yield* Deferred.make<Result, HostError>()
        const info = { ...input, id } as Request
        pending.set(id, { info, deferred })
        return yield* Effect.gen(function* () {
          yield* bus.publish(Event.Requested, info)
          return yield* Deferred.await(deferred).pipe(
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () => cancel(current, id, "timeout").pipe(Effect.andThen(Deferred.await(deferred))),
            }),
          )
        }).pipe(Effect.ensuring(cancel(current, id, "cancelled")))
      })

      const list: Interface["list"] = Effect.fn("AgentManager.list")(function* () {
        return Array.from((yield* state()).pending.values(), (entry) => entry.info)
      })

      const reply: Interface["reply"] = Effect.fn("AgentManager.reply")(function* (input) {
        const pending = (yield* state()).pending
        const entry = pending.get(input.requestID)
        if (!entry) {
          log.warn("reply for unknown request", { requestID: input.requestID })
          return yield* new NotFoundError({ requestID: input.requestID })
        }
        if (!matches(entry.info, input.result)) return yield* new InvalidReplyError({ requestID: input.requestID })
        pending.delete(input.requestID)
        yield* Deferred.succeed(entry.deferred, input.result)
      })

      const reject: Interface["reject"] = Effect.fn("AgentManager.reject")(function* (input) {
        const pending = (yield* state()).pending
        const entry = pending.get(input.requestID)
        if (!entry) {
          log.warn("rejection for unknown request", { requestID: input.requestID })
          return yield* new NotFoundError({ requestID: input.requestID })
        }
        pending.delete(input.requestID)
        yield* Deferred.fail(entry.deferred, new HostError({ code: input.error.code, detail: input.error.message }))
      })

      return Service.of({ request, list, reply, reject })
    }),
  )
}

export const defaultLayer = layer().pipe(Layer.provide(Bus.layer))
export const node = LayerNode.make({ service: Service, layer: layer(), deps: [Bus.node] })
export * as AgentManager from "./service"
