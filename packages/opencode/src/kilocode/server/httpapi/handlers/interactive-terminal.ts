import { InteractiveTerminal } from "@/kilocode/interactive-terminal"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"

const missing = () => new HttpApiError.NotFound({})

export const interactiveTerminalHandlers = HttpApiBuilder.group(InstanceHttpApi, "interactive-terminal", (handlers) =>
  Effect.gen(function* () {
    const list = Effect.fn("InteractiveTerminalHttpApi.list")(function* () {
      const infos = yield* Effect.promise(() => InteractiveTerminal.list())
      return yield* Effect.promise(() =>
        Promise.all(infos.map((info) => InteractiveTerminal.get(info.id))).then((items) =>
          items.filter((item) => item !== undefined),
        ),
      )
    })

    const get = Effect.fn("InteractiveTerminalHttpApi.get")(function* (ctx: {
      params: { terminalID: InteractiveTerminal.ID }
    }) {
      const terminal = yield* Effect.promise(() => InteractiveTerminal.get(ctx.params.terminalID))
      if (!terminal) return yield* missing()
      return terminal
    })

    const write = Effect.fn("InteractiveTerminalHttpApi.write")(function* (ctx: {
      params: { terminalID: InteractiveTerminal.ID }
      payload: typeof InteractiveTerminal.WriteInput.Type
    }) {
      const ok = yield* Effect.promise(() => InteractiveTerminal.write(ctx.params.terminalID, ctx.payload.data))
      if (!ok) return yield* missing()
      return true
    })

    const resize = Effect.fn("InteractiveTerminalHttpApi.resize")(function* (ctx: {
      params: { terminalID: InteractiveTerminal.ID }
      payload: typeof InteractiveTerminal.ResizeInput.Type
    }) {
      const ok = yield* Effect.promise(() =>
        InteractiveTerminal.resize(ctx.params.terminalID, ctx.payload.cols, ctx.payload.rows),
      )
      if (!ok) return yield* missing()
      return true
    })

    const close = Effect.fn("InteractiveTerminalHttpApi.close")(function* (ctx: {
      params: { terminalID: InteractiveTerminal.ID }
    }) {
      const ok = yield* Effect.promise(() => InteractiveTerminal.close(ctx.params.terminalID))
      if (!ok) return yield* missing()
      return true
    })

    return handlers
      .handle("list", list)
      .handle("get", get)
      .handle("write", write)
      .handle("resize", resize)
      .handle("close", close)
  }),
)
