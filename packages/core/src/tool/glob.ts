export * as GlobTool from "./glob"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util" // kilocode_change
import * as SearchTarget from "../kilocode/search-target" // kilocode_change
import { Location } from "../location"
import { Reference } from "../reference" // kilocode_change
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
  reference: Schema.NonEmptyString.pipe(Schema.optional).annotate({
    description: "Named project reference to search instead of the active Location",
  }), // kilocode_change
  limit: FileSystem.SearchLimit.pipe(Schema.optional).annotate({
    description: "Maximum results to return",
  }), // kilocode_change
})

// kilocode_change start - retain bounded-search status in tool results and model output
export class Result extends Schema.Class<Result>("GlobTool.Result")({
  items: Schema.Array(FileSystem.Entry),
  truncated: Schema.Boolean,
  partial: Schema.Boolean,
}) {}
export const Output = Result
type ModelOutput = typeof Output.Encoded

/** Format raw search results into the concise line-oriented output models expect. */
export const toModelOutput = (output: ModelOutput) => {
  const lines = output.items.length === 0 ? ["No files found"] : output.items.map((item) => item.path)
  if (output.truncated) lines.push("", `(Results truncated: showing first ${output.items.length} files.)`)
  if (output.partial) lines.push("", "(Some discovered files could not be read.)")
  return lines.join("\n")
}
// kilocode_change end

/** Glob leaf that defaults its filesystem root to the active Location. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fs = yield* FSUtil.Service // kilocode_change
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const references = yield* Reference.Service // kilocode_change
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
              // kilocode_change start - model paths remain absolute while the typed result retains metadata
              text: toModelOutput({
                ...output,
                items: output.items.map((entry) => ({ ...entry, path: path.resolve(location.directory, entry.path) })),
              }),
              // kilocode_change end
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
                  reference: input.reference, // kilocode_change
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              // kilocode_change start - enforce the active Location despite RelativePath being a nominal brand
              const ref = input.reference
                ? (yield* references.list()).find((item) => item.name === input.reference)
                : undefined
              if (input.reference && !ref) return yield* Effect.fail(new Error("Project reference not found"))
              const base = ref?.path ?? location.directory
              const requested = path.resolve(base, input.path ?? ".")
              if (!FSUtil.contains(base, requested))
                return yield* Effect.fail(new Error("Path escapes the active Location"))
              const root = yield* SearchTarget.inspect(fs, base)
              const target = yield* SearchTarget.inspect(fs, requested)
              if (root.type !== "directory" || target.type !== "directory" || !FSUtil.contains(root.path, target.path))
                return yield* Effect.fail(new Error("Path escapes the active Location"))
              // kilocode_change end
              return yield* ripgrep
                .glob({
                  cwd: target.path, // kilocode_change
                  pattern: input.pattern,
                  limit: input.limit ?? FileSystem.DEFAULT_SEARCH_LIMIT, // kilocode_change
                  validate: SearchTarget.validate(fs, target), // kilocode_change - reject post-approval replacement
                })
                .pipe(
                  // kilocode_change start - preserve search status after canonical path mapping
                  Effect.map(
                    (result) =>
                      new Result({
                        ...result,
                        items: result.items.map(
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
                      }),
                  ),
                  // kilocode_change end
                )
            }).pipe(
              Effect.mapError(() => new ToolFailure({ message: `Unable to find files matching ${input.pattern}` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
