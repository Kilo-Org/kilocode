import { BackgroundProcess } from "@/kilocode/background-process"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"

const missing = () => new HttpApiError.NotFound({})

export const backgroundProcessHandlers = HttpApiBuilder.group(InstanceHttpApi, "background-process", (handlers) =>
  Effect.gen(function* () {
    const list = Effect.fn("BackgroundProcessHttpApi.list")(function* () {
      return yield* Effect.promise(() => BackgroundProcess.list())
    })

    const get = Effect.fn("BackgroundProcessHttpApi.get")(function* (ctx: {
      params: { processID: BackgroundProcess.ID }
    }) {
      const info = yield* Effect.promise(() => BackgroundProcess.get(ctx.params.processID))
      if (!info) return yield* missing()
      return info
    })

    const logs = Effect.fn("BackgroundProcessHttpApi.logs")(function* (ctx: {
      params: { processID: BackgroundProcess.ID }
    }) {
      const info = yield* Effect.promise(() => BackgroundProcess.logs(ctx.params.processID))
      if (!info) return yield* missing()
      return info
    })

    const stop = Effect.fn("BackgroundProcessHttpApi.stop")(function* (ctx: {
      params: { processID: BackgroundProcess.ID }
    }) {
      const info = yield* Effect.promise(() => BackgroundProcess.stop(ctx.params.processID))
      if (!info) return yield* missing()
      return info
    })

    const restart = Effect.fn("BackgroundProcessHttpApi.restart")(function* (ctx: {
      params: { processID: BackgroundProcess.ID }
    }) {
      const info = yield* Effect.promise(() => BackgroundProcess.restart(ctx.params.processID))
      if (!info) return yield* missing()
      return info
    })

    const stopSession = Effect.fn("BackgroundProcessHttpApi.stopSession")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      yield* Effect.promise(() => BackgroundProcess.stopSession(ctx.params.sessionID))
      return true
    })

    return handlers
      .handle("list", list)
      .handle("get", get)
      .handle("logs", logs)
      .handle("stop", stop)
      .handle("restart", restart)
      .handle("stopSession", stopSession)
  }),
)
