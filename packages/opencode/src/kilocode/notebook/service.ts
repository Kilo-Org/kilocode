import { Bus } from "@/bus"
import { InstanceRef } from "@/effect/instance-ref"
import { registerDisposer } from "@/effect/instance-registry"
import { Identifier } from "@/id/id"
import { capture } from "@/kilocode/instance"
import { Context, Deferred, Duration, Effect, Layer, LayerMap, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ErrorCode, Event, type Failure, type Request, RequestID, type Result } from "./protocol"

const log = Log.create({ service: "notebook-host" })
type WithoutID<T> = T extends unknown ? Omit<T, "id"> : never
export type Input = WithoutID<Request>

export class HostError extends Schema.TaggedErrorClass<HostError>()("NotebookHostError", {
  code: ErrorCode,
  detail: Schema.String,
  path: Schema.optional(Schema.String),
  index: Schema.optional(Schema.Number),
  currentRevision: Schema.optional(Schema.String),
}) {
  override get message() {
    return this.detail
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Notebook.NotFoundError", {
  requestID: RequestID,
}) {}

export class InvalidReplyError extends Schema.TaggedErrorClass<InvalidReplyError>()("Notebook.InvalidReplyError", {
  requestID: RequestID,
}) {}

interface Entry {
  info: Request
  deferred: Deferred.Deferred<Result, HostError>
}
interface State {
  pending: Map<RequestID, Entry>
  dispose: () => Effect.Effect<void>
}

class StateService extends Context.Service<StateService, State>()("@kilocode/NotebookState") {}

const context = Effect.gen(function* () {
  const ctx = (yield* InstanceRef) ?? capture()
  if (!ctx) return yield* Effect.die(new Error("Instance context not provided"))
  return ctx
})

function matches(request: Request, result: Result) {
  if (request.path !== result.requestPath) return false
  if (request.operation === "read") return result.operation === "read"
  if (request.operation === "execute") return result.operation === "execute" && request.index === result.index
  return result.operation === "edit" && request.index === result.index && request.edit.action === result.action
}

export interface Interface {
  readonly request: (input: Input) => Effect.Effect<Result, HostError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  readonly cancelSession: (sessionID: Request["sessionID"]) => Effect.Effect<void>
  readonly reply: (input: {
    requestID: RequestID
    result: Result
  }) => Effect.Effect<void, NotFoundError | InvalidReplyError>
  readonly reject: (input: { requestID: RequestID; error: Failure }) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/Notebook") {}

export function layer(timeout: Duration.Input = "10 minutes") {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const states = new Map<string, State>()
      const stateLayer = (directory: string) =>
        Layer.effect(
          StateService,
          Effect.gen(function* () {
            const instance = (yield* InstanceRef) ?? capture()
            if (!instance) return yield* Effect.die(new Error("Instance context not provided"))
            const pending = new Map<RequestID, Entry>()
            const dispose = Effect.fn("Notebook.dispose")(function* () {
              const entries = Array.from(pending.values())
              pending.clear()
              for (const entry of entries) {
                yield* bus
                  .publish(Event.Cancelled, {
                    requestID: entry.info.id,
                    sessionID: entry.info.sessionID,
                    reason: "disposed" as const,
                  })
                  .pipe(Effect.provideService(InstanceRef, instance))
                yield* Deferred.fail(
                  entry.deferred,
                  new HostError({ code: "disconnected", detail: "The notebook host disconnected" }),
                )
              }
            })
            const state: State = { pending, dispose }
            states.set(directory, state)
            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                if (states.get(directory) === state) states.delete(directory)
                yield* state.dispose()
              }),
            )
            return StateService.of(state)
          }),
        )
      const map = yield* LayerMap.make((directory: string) => stateLayer(directory), { idleTimeToLive: "10 minutes" })
      const off = registerDisposer((directory) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const state = states.get(directory)
            yield* map.invalidate(directory)
            if (state) {
              yield* state.dispose()
              if (states.get(directory) === state) states.delete(directory)
            }
          }),
        ),
      )
      yield* Effect.addFinalizer(() => Effect.sync(off))

      const use = <A, E>(effect: Effect.Effect<A, E, StateService>): Effect.Effect<A, E> => {
        const run = Effect.gen(function* () {
          const ctx = yield* context
          return yield* effect.pipe(Effect.provide(map.get(ctx.directory)))
        })
        return run.pipe(Effect.scoped)
      }

      const cancel = Effect.fn("Notebook.cancel")(function* (id: RequestID, reason: "cancelled" | "timeout") {
        const pending = (yield* StateService).pending
        const entry = pending.get(id)
        if (!entry) return
        pending.delete(id)
        yield* bus.publish(Event.Cancelled, { requestID: id, sessionID: entry.info.sessionID, reason })
        yield* Deferred.fail(
          entry.deferred,
          new HostError({
            code: reason,
            detail:
              reason === "timeout" ? "The notebook host request timed out" : "The notebook host request was cancelled",
          }),
        )
      })

      const request = Effect.fn("Notebook.request")(function* (input: Input) {
        const pending = (yield* StateService).pending
        const id = RequestID.make(Identifier.create("nbr", "ascending"))
        const deferred = yield* Deferred.make<Result, HostError>()
        const info = { ...input, id } as Request
        pending.set(id, { info, deferred })
        return yield* Effect.gen(function* () {
          yield* bus.publish(Event.Requested, info)
          return yield* Deferred.await(deferred).pipe(
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () => cancel(id, "timeout").pipe(Effect.andThen(Deferred.await(deferred))),
            }),
          )
        }).pipe(Effect.ensuring(cancel(id, "cancelled")))
      })

      const list = Effect.fn("Notebook.list")(function* () {
        return Array.from((yield* StateService).pending.values(), (entry) => entry.info)
      })

      const cancelSession = Effect.fn("Notebook.cancelSession")(function* (sessionID: Request["sessionID"]) {
        const pending = (yield* StateService).pending
        const ids = Array.from(pending.values())
          .filter((entry) => entry.info.sessionID === sessionID)
          .map((entry) => entry.info.id)
        yield* Effect.forEach(ids, (id) => cancel(id, "cancelled"), { discard: true })
      })

      const reply = Effect.fn("Notebook.reply")(function* (input: Parameters<Interface["reply"]>[0]) {
        const pending = (yield* StateService).pending
        const entry = pending.get(input.requestID)
        if (!entry) {
          log.warn("reply for unknown request", { requestID: input.requestID })
          return yield* new NotFoundError({ requestID: input.requestID })
        }
        if (!matches(entry.info, input.result)) return yield* new InvalidReplyError({ requestID: input.requestID })
        pending.delete(input.requestID)
        yield* Deferred.succeed(entry.deferred, input.result)
        return yield* Effect.void
      })

      const reject = Effect.fn("Notebook.reject")(function* (input: Parameters<Interface["reject"]>[0]) {
        const pending = (yield* StateService).pending
        const entry = pending.get(input.requestID)
        if (!entry) {
          log.warn("rejection for unknown request", { requestID: input.requestID })
          return yield* new NotFoundError({ requestID: input.requestID })
        }
        pending.delete(input.requestID)
        yield* Deferred.fail(
          entry.deferred,
          new HostError({
            code: input.error.code,
            detail: input.error.message,
            path: input.error.path,
            index: input.error.index,
            currentRevision: input.error.currentRevision,
          }),
        )
        return yield* Effect.void
      })

      return Service.of({
        request: (input) => use(request(input)),
        list: () => use(list()),
        cancelSession: (sessionID) => use(cancelSession(sessionID)),
        reply: (input) => use(reply(input)),
        reject: (input) => use(reject(input)),
      })
    }),
  )
}

export const defaultLayer = layer().pipe(Layer.provide(Bus.layer))
export const node = LayerNode.make({ service: Service, layer: layer(), deps: [Bus.node] })
export * as Notebook from "./service"
