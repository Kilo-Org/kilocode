import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import type { MemoryOperations } from "@kilocode/kilo-memory/ops"
import { MemorySchema } from "@kilocode/kilo-memory/schema"
import { InstanceState } from "@/effect/instance-state"
import { MemoryError } from "@/kilocode/memory/errors"
import { MemoryService } from "@/kilocode/memory/service"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import {
  MemoryConfigurePayload,
  MemoryCorrectPayload,
  MemoryForgetPayload,
  MemoryPurgePayload,
  MemoryQuery,
  MemoryRememberPayload,
} from "../groups/memory"

type ApiState = Omit<MemorySchema.State, "stats"> & {
  stats: Omit<
    MemorySchema.Stats,
    "lastInjectedAt" | "lastInjectedSessionID" | "lastConsolidatedAt" | "lastConsolidatedMessageID"
  > & {
    lastInjectedAt: number
    lastInjectedSessionID: string
    lastConsolidatedAt: number
  }
}

type ApiOperation = MemoryOperations.Result

function state(input: MemorySchema.State): ApiState {
  return {
    ...input,
    stats: {
      lastInjectedAt: input.stats.lastInjectedAt ?? 0,
      lastInjectedBytes: input.stats.lastInjectedBytes,
      lastInjectedTokens: input.stats.lastInjectedTokens,
      lastInjectedSessionID: input.stats.lastInjectedSessionID ?? "",
      lastConsolidatedAt: input.stats.lastConsolidatedAt ?? 0,
      lastConsolidationCost: input.stats.lastConsolidationCost,
      lastConsolidationTokens: input.stats.lastConsolidationTokens,
      lastOperationCount: input.stats.lastOperationCount,
    },
  }
}

function output<T extends { state: MemorySchema.State }>(input: T): Omit<T, "state"> & { state: ApiState } {
  return { ...input, state: state(input.state) }
}

function operation(input: MemoryOperations.Result): ApiOperation {
  return {
    operationCount: input.operationCount,
    added: input.added,
    removed: input.removed,
    skipped: input.skipped,
    index: input.index,
  }
}

function api<T>(effect: Effect.Effect<T, MemoryError>) {
  return effect.pipe(Effect.mapError(MemoryError.toHttp))
}

export const memoryHandlers = HttpApiBuilder.group(InstanceHttpApi, "memory", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* MemoryService.Service
    const status = Effect.fn("MemoryHttpApi.status")(function* (req: { query: typeof MemoryQuery.Type }) {
      const ctx = yield* InstanceState.context
      return output(yield* api(svc.status({ ctx })))
    })

    const show = Effect.fn("MemoryHttpApi.show")(function* (req: { query: typeof MemoryQuery.Type }) {
      const ctx = yield* InstanceState.context
      return output(yield* api(svc.show({ ctx })))
    })

    const enable = Effect.fn("MemoryHttpApi.enable")(function* (req: { query: typeof MemoryQuery.Type }) {
      const ctx = yield* InstanceState.context
      return output(yield* api(svc.enable({ ctx })))
    })

    const disable = Effect.fn("MemoryHttpApi.disable")(function* (req: { query: typeof MemoryQuery.Type }) {
      const ctx = yield* InstanceState.context
      return output(yield* api(svc.disable({ ctx })))
    })

    const configure = Effect.fn("MemoryHttpApi.configure")(function* (req: {
      query: typeof MemoryQuery.Type
      payload: typeof MemoryConfigurePayload.Type
    }) {
      const ctx = yield* InstanceState.context
      return output(yield* api(svc.configure({ ctx, settings: { autoConsolidate: req.payload.autoConsolidate } })))
    })

    const rebuild = Effect.fn("MemoryHttpApi.rebuild")(function* (req: { query: typeof MemoryQuery.Type }) {
      const ctx = yield* InstanceState.context
      return output(yield* api(svc.rebuild({ ctx })))
    })

    const remember = Effect.fn("MemoryHttpApi.remember")(function* (req: {
      query: typeof MemoryQuery.Type
      payload: typeof MemoryRememberPayload.Type
    }) {
      const state = yield* InstanceState.context
      return operation(
        yield* api(
          svc.remember({
            ctx: state,
            sessionID: req.payload.sessionID,
            file: req.payload.file,
            section: req.payload.section,
            key: req.payload.key,
            text: req.payload.text,
          }),
        ),
      )
    })

    const correct = Effect.fn("MemoryHttpApi.correct")(function* (req: {
      query: typeof MemoryQuery.Type
      payload: typeof MemoryCorrectPayload.Type
    }) {
      const state = yield* InstanceState.context
      return operation(
        yield* api(
          svc.correct({
            ctx: state,
            sessionID: req.payload.sessionID,
            key: req.payload.key,
            text: req.payload.text,
          }),
        ),
      )
    })

    const forget = Effect.fn("MemoryHttpApi.forget")(function* (req: {
      query: typeof MemoryQuery.Type
      payload: typeof MemoryForgetPayload.Type
    }) {
      const state = yield* InstanceState.context
      return operation(
        yield* api(svc.forget({ ctx: state, query: req.payload.query, sessionID: req.payload.sessionID })),
      )
    })

    const purge = Effect.fn("MemoryHttpApi.purge")(function* (req: {
      query: typeof MemoryQuery.Type
      payload: typeof MemoryPurgePayload.Type
    }) {
      const ctx = yield* InstanceState.context
      return yield* api(svc.purge({ ctx }))
    })

    return handlers
      .handle("status", status)
      .handle("show", show)
      .handle("enable", enable)
      .handle("disable", disable)
      .handle("configure", configure)
      .handle("rebuild", rebuild)
      .handle("remember", remember)
      .handle("correct", correct)
      .handle("forget", forget)
      .handle("purge", purge)
  }),
)
