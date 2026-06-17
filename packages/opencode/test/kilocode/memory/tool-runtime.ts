import { Effect, Layer } from "effect"
import { Agent } from "../../../src/agent/agent"
import { MemoryService } from "../../../src/kilocode/memory/service"
import type { Tool } from "../../../src/tool/tool"
import * as Truncate from "../../../src/tool/truncate"

const info = {
  name: "code",
  mode: "primary",
  options: {},
  permission: {},
} as Agent.Info

const agents = Agent.Service.of({
  get: () => Effect.succeed(info),
  list: () => Effect.succeed([info]),
  defaultInfo: () => Effect.succeed(info),
  defaultAgent: () => Effect.succeed("code"),
  generate: () => Effect.succeed({ identifier: "code", whenToUse: "", systemPrompt: "" }),
})

const truncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed(""),
  output: (text) => Effect.succeed({ content: text, truncated: false }),
  limits: () => Effect.succeed({ maxLines: Truncate.MAX_LINES, maxBytes: Truncate.MAX_BYTES }),
})

const layer = Layer.mergeAll(
  MemoryService.defaultLayer,
  Layer.succeed(Agent.Service, agents),
  Layer.succeed(Truncate.Service, truncate),
)

export function runMemoryTool(
  input: Effect.Effect<Tool.Info, never, MemoryService.Service | Agent.Service | Truncate.Service>,
  params: unknown,
  ctx: Tool.Context,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* input
      const tool = yield* result.init()
      return yield* tool.execute(params, ctx)
    }).pipe(Effect.provide(layer)),
  )
}
