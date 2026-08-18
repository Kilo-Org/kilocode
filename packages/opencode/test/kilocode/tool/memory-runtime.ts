import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import type { Tool } from "@/tool/tool"
import * as Truncate from "@/tool/truncate"

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
  requirementStatus: () =>
    Effect.succeed({
      agent: "code",
      directory: "",
      enabled: false,
      state: "ready",
      skills: [],
      mcps: [],
      vscode_extensions: [],
    }),
  guardRequirements: () => Effect.void,
  generate: () => Effect.succeed({ identifier: "code", whenToUse: "", systemPrompt: "" }),
})

const truncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed(""),
  output: (text) => Effect.succeed({ content: text, truncated: false }),
  limits: () => Effect.succeed({ maxLines: Truncate.MAX_LINES, maxBytes: Truncate.MAX_BYTES }),
})

const layer = Layer.mergeAll(
  MemoryService.layer,
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
