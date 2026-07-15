export * as GlobTool from "./glob"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util" // kilocode_change
import * as SearchTarget from "../kilocode/search-target" // kilocode_change
import { Location } from "../location"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "glob"

export const Input = Schema.Struct({
  pattern: FileSystem.GlobInput.fields.pattern.annotate({ description: "Glob pattern to match files against" }),
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory to search. Defaults to the active Location.",
  }),
  limit: FileSystem.GlobInput.fields.limit.annotate({
    description: "Maximum results to return",
  }),
})

export const Output = Schema.Array(FileSystem.Entry)
type ModelOutput = typeof Output.Encoded

/** Format raw search results into the concise line-oriented output models expect. */
export const toModelOutput = (output: ModelOutput) => {
  const lines = output.length === 0 ? ["No files found"] : output.map((item) => item.path)
  return lines.join("\n")
}

/** Glob leaf that defaults its filesystem root to the active Location. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fs = yield* FSUtil.Service // kilocode_change
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Find files by glob pattern within the active Location. Returns concise relative file resources. Use a relative path to narrow the search and limit to bound the result count.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: toModelOutput(
                output.map((entry) => ({ ...entry, path: path.resolve(location.directory, entry.path) })),
              ),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: input.path ?? ".",
                  path: input.path,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              // kilocode_change start - enforce the active Location despite RelativePath being a nominal brand
              const requested = path.resolve(location.directory, input.path ?? ".")
              if (!FSUtil.contains(location.directory, requested))
                return yield* Effect.fail(new Error("Path escapes the active Location"))
              const root = yield* SearchTarget.inspect(fs, location.directory)
              const target = yield* SearchTarget.inspect(fs, requested)
              if (root.type !== "directory" || target.type !== "directory" || !FSUtil.contains(root.path, target.path))
                return yield* Effect.fail(new Error("Path escapes the active Location"))
              // kilocode_change end
              return yield* ripgrep
                .glob({
                  cwd: target.path, // kilocode_change
                  pattern: input.pattern,
                  limit: input.limit ?? 100, // kilocode_change - bound omitted limits
                  validate: SearchTarget.validate(fs, target), // kilocode_change - reject post-approval replacement
                })
                .pipe(
                  Effect.map((result) =>
                    result.map(
                      // kilocode_change start - report paths from the canonical validated target
                      (entry) =>
                        new FileSystem.Entry({
                          ...entry,
                          path: RelativePath.make(
                            path.relative(location.directory, path.resolve(target.path, entry.path)),
                          ),
                        }),
                      // kilocode_change end
                    ),
                  ),
                )
            }).pipe(
              Effect.mapError(() => new ToolFailure({ message: `Unable to find files matching ${input.pattern}` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
