export * as SessionSyncOutput from "./tool-output"

import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { ToolOutput } from "@opencode/core/tool-output"
import type { Tool } from "@opencode/core/tool"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Layer } from "effect"
import { SessionSync } from "./index"
import { Assets } from "./assets"

const layer = Layer.effect(
  ToolOutput.Service,
  Effect.gen(function* () {
    const native = yield* ToolOutput.Service
    const { db } = yield* Database.Service
    const location = yield* Location.Service
    const global = yield* Global.Service
    const remember = (file: string) =>
      location.workspaceID !== undefined
        ? Effect.void
        : Assets.owned(db, global, location.directory, file).pipe(
            Effect.catchCause(() =>
              Effect.logWarning("Session synchronization could not record native output provenance"),
            ),
          )
    return ToolOutput.Service.of({
      ...native,
      save: Effect.fn("SessionSyncOutput.save")(function* (bytes: Uint8Array, extension: string) {
        const file = yield* native.save(bytes, extension)
        yield* remember(file)
        return file
      }),
      truncate: Effect.fn("SessionSyncOutput.truncate")(function* (input: Tool.NormalizedResult) {
        const result = yield* native.truncate(input)
        // The native fast path returns caller-owned metadata untouched. It is not an allocation and
        // must never authorize the caller's outputPath, even when truncated=true was supplied.
        if (
          result !== input &&
          input.metadata?.truncated === undefined &&
          result.metadata?.truncated === true &&
          typeof result.metadata.outputPath === "string" &&
          result.metadata.outputPath !== input.metadata?.outputPath
        )
          yield* remember(result.metadata.outputPath)
        return result
      }),
    })
  }),
).pipe(Layer.provide(ToolOutput.layer))

export const node = makeLocationNode({
  service: ToolOutput.Service,
  layer,
  deps: [FSUtil.node, Global.node, ToolOutput.cleanupNode, Location.node, Database.node, SessionSync.node],
})
