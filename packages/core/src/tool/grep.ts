export * as GrepTool from "./grep"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Global } from "../global" // kilocode_change
import * as SearchTarget from "../kilocode/search-target" // kilocode_change
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "grep"

export const Input = Schema.Struct({
  pattern: FileSystem.GrepInput.fields.pattern.annotate({
    description: "Regex pattern to search for in file contents",
  }),
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory to search. Defaults to the active Location.",
  }),
  include: FileSystem.GrepInput.fields.include.annotate({
    description: 'File glob to include in the search (for example, "*.js" or "*.{ts,tsx}")',
  }),
  limit: FileSystem.GrepInput.fields.limit.annotate({
    description: "Maximum matches to return",
  }),
})

export const Output = Schema.Array(FileSystem.Match)
type ModelOutput = typeof Output.Encoded

/** Format raw search matches into the familiar concise model output. */
export const toModelOutput = (output: ModelOutput) => {
  const lines = output.length === 0 ? ["No files found"] : [`Found ${output.length} matches`]
  let current = ""
  for (const match of output) {
    if (current !== match.entry.path) {
      if (current) lines.push("")
      current = match.entry.path
      lines.push(`${match.entry.path}:`)
    }
    lines.push(`  Line ${match.line}: ${match.text}`)
  }
  return lines.join("\n")
}

/** Grep leaf that defaults its filesystem root to the active Location. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service // kilocode_change
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Search file contents by regular expression within the active Location or an absolute managed tool-output file. Use a path to narrow the search, include to filter files by glob, and limit to bound the match count. Returns concise file resources, line numbers, and bounded line previews.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: toModelOutput(
                output.map((match) => ({
                  ...match,
                  entry: { ...match.entry, path: path.resolve(location.directory, match.entry.path) },
                })),
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
                  root: ".",
                  path: input.path,
                  include: input.include,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              // kilocode_change start - enforce the active Location despite RelativePath being a nominal brand
              const requested = path.resolve(location.directory, input.path ?? ".")
              const absolute = path.isAbsolute(input.path ?? "")
              if (!FSUtil.contains(location.directory, requested) && !absolute)
                return yield* Effect.fail(new Error("Path escapes the active Location"))
              const root = yield* SearchTarget.inspect(fs, location.directory)
              const target = yield* SearchTarget.inspect(fs, requested)
              const contained = root.type === "directory" && FSUtil.contains(root.path, target.path)
              const retained = absolute && !contained && (yield* SearchTarget.managed(fs, global.data, target))
              if (root.type !== "directory" || (!contained && !retained))
                return yield* Effect.fail(new Error("Path escapes the active Location"))
              // kilocode_change end
              const cwd = target.type === "directory" ? target.path : path.dirname(target.path) // kilocode_change
              return yield* ripgrep
                .grep({
                  cwd, // kilocode_change
                  pattern: input.pattern,
                  file: target.type === "file" ? path.basename(target.path) : undefined, // kilocode_change
                  include: input.include,
                  limit: input.limit ?? Number.MAX_SAFE_INTEGER,
                  validate: SearchTarget.validate(fs, target), // kilocode_change - reject post-approval replacement
                })
                .pipe(
                  Effect.map((result) =>
                    result.map(
                      (match) =>
                        new FileSystem.Match({
                          ...match,
                          entry: new FileSystem.Entry({
                            ...match.entry,
                            path: RelativePath.make(
                              path.relative(
                                location.directory,
                                path.resolve(cwd, match.entry.path), // kilocode_change
                              ),
                            ),
                          }),
                        }),
                    ),
                  ),
                )
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to grep for ${input.pattern}` }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
