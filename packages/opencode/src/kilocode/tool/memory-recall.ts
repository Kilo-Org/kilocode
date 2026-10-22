import { Effect } from "effect"
import { Instance } from "@/kilocode/instance"
import * as Tool from "@/tool/tool"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { MemoryTool } from "@kilocode/kilo-memory/tool"

export const MemoryRecallTool = Tool.define(
  "kilo_memory_recall",
  Effect.gen(function* () {
    const memory = yield* MemoryService.Service
    return {
      description: MemoryTool.RecallDescription,
      parameters: MemoryTool.RecallParameters,
      execute: (params: MemoryTool.RecallParams, ctx: Tool.Context) =>
        MemoryTool.recall({
          memory,
          params,
          sessionID: ctx.sessionID,
          ctx: { directory: Instance.directory, worktree: Instance.worktree },
          ask: ctx.ask,
        }).pipe(Effect.catchIf(MemoryTool.failure, (err) => Effect.succeed(MemoryTool.error("recall", err)))),
    }
  }),
)
