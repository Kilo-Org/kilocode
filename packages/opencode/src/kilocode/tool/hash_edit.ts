import { Schema, Effect } from "effect"
import * as path from "path"
import * as Tool from "../../tool/tool"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { Bus } from "@/bus"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { applyHashEdit, HashlineError, formatFileWithHashes, stripHashes } from "../hashline/hashline"
import DESCRIPTION from "./hash_edit.txt"
import { assertExternalDirectoryEffect } from "../../tool/external-directory"

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "The absolute path to the file to edit",
  }),
  operation: Schema.Literal("replace", "delete", "insert_before", "insert_after").annotate({
    description: "The edit operation to perform",
  }),
  startRef: Schema.String.annotate({
    description:
      "Hash reference for the target line, in the format '#HL <line>:<hash>|...' or '<line>:<hash>' (e.g. '#HL 2:f1c|const x = 1;' or '2:f1c')",
  }),
  endRef: Schema.optional(Schema.String).annotate({
    description:
      "Hash reference for the end line of a range (required for replace-range operations). Same format as startRef.",
  }),
  replacement: Schema.optional(Schema.String).annotate({
    description: "The new content to replace with (required for replace, insert_before, insert_after operations)",
  }),
  fileRev: Schema.optional(Schema.String).annotate({
    description:
      "Optional file revision hash (8-char hex) from the #HL REV: header. If provided, guards against concurrent edits.",
  }),
})

export const HashEditTool = Tool.define(
  "hash_edit",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(instance.directory, params.filePath)

          yield* assertExternalDirectoryEffect(ctx, filepath)

          const stat = yield* fs.stat(filepath).pipe(
            Effect.catchIf(
              (err) => "reason" in err && err.reason._tag === "NotFound",
              () => Effect.succeed(undefined),
            ),
          )
          if (!stat) {
            return yield* Effect.fail(new Error(`File not found: ${filepath}`))
          }

          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(instance.worktree, filepath)],
            always: ["*"],
            metadata: { filepath },
          })

          const bytes = yield* fs.readFile(filepath)
          const raw = Buffer.from(bytes).toString("utf-8")

          // Strip any existing hashline annotations before applying the edit
          // so applyHashEdit operates on clean file content
          const content = stripHashes(raw)

          const result = yield* Effect.try({
            try: () =>
              applyHashEdit(
                {
                  operation: params.operation,
                  startRef: params.startRef,
                  endRef: params.endRef,
                  replacement: params.replacement,
                  fileRev: params.fileRev,
                },
                content,
              ),
            catch: (err) => {
              if (err instanceof HashlineError) {
                return new Error(
                  `Hash edit failed [${err.code}]: ${err.message}${err.hint ? `\n\nHint: ${err.hint}` : ""}`,
                )
              }
              return err instanceof Error ? err : new Error(String(err))
            },
          })

          yield* fs.writeFileString(filepath, result.content)
          yield* bus.publish(File.Event.Edited, { file: filepath })
          yield* bus.publish(FileWatcher.Event.Updated, { file: filepath, event: "change" })

          const title = path.relative(instance.worktree, filepath)
          const summary = `Applied ${params.operation} at line ${result.startLine}${result.endLine !== result.startLine ? `–${result.endLine}` : ""}`

          return {
            title,
            output: `${summary} in ${title}. Edit applied successfully.`,
            metadata: {
              filepath,
              operation: params.operation,
              startLine: result.startLine,
              endLine: result.endLine,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export { formatFileWithHashes }
