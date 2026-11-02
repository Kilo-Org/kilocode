import { fileDiff } from "@opencode/core/tool/plugin/file-diff"
import { define } from "@opencode/plugin/effect/plugin"
import { Bom } from "@opencode/util/bom"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, type Scope } from "effect"
import path from "path"

type Input = { readonly path: string }

// The `write` output schema in @opencode/core.
type Output = { readonly target: string; readonly resource: string; readonly existed: boolean }

/**
 * Adds the final diff of every `write` call to its tool result metadata, which the session renderer shows under
 * the file header and in the diff viewer. The core tool returns no diff, so the file is read again here after
 * formatting, rather than reusing the permission preview, which describes the content before the formatter runs.
 *
 * Only a target inside the Location is read before the call, because that read runs before the tool's
 * external-directory approval.
 */
export const KiloWriteToolPlugin = define<FSUtil.Service | Scope.Scope>({
  id: "kilocode.tool-write",
  effect: Effect.fn("KiloWriteTool.Plugin")(function* (ctx) {
    const fs = yield* FSUtil.Service
    yield* ctx.tool.transform((editor) =>
      editor.update("write", (tool) => {
        const execute = tool.execute
        tool.execute = (input: Input, context) =>
          Effect.gen(function* () {
            const target = path.resolve(ctx.location.directory, input.path)
            const before = FSUtil.contains(ctx.location.directory, target) ? yield* existing(fs, target) : undefined
            const result = yield* execute(input, context)
            const output = result.output as Output | undefined
            if (before === undefined || output === undefined) return result
            const after = yield* read(fs, output.target)
            if (after === undefined) return result
            const file = fileDiff(output.resource, before, after, output.existed ? "modified" : "added")
            return { ...result, metadata: { ...result.metadata, files: [file] } }
          })
      }),
    )
  }),
})

/** The current text, or an empty string when the write creates the file. */
const existing = (fs: FSUtil.Interface, target: string) =>
  fs.existsSafe(target).pipe(Effect.andThen((exists) => (exists ? read(fs, target) : Effect.succeed(""))))

/** A preview read, so an unreadable file leaves the result without a diff instead of failing the write. */
const read = (fs: FSUtil.Interface, target: string) =>
  fs.readFileStringSafe(target).pipe(
    Effect.map((text) => (text === undefined ? undefined : Bom.split(text).text)),
    Effect.orElseSucceed(() => undefined),
  )
