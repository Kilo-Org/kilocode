import { resolvePath } from "@opencode/core/file-access"
import { fileDiff } from "@opencode/core/tool/plugin/file-diff"
import { define } from "@opencode/plugin/effect/plugin"
import type { FileDiff } from "@opencode/schema/file-diff"
import { Bom } from "@opencode/util/bom"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, type Scope } from "effect"
import path from "path"

type Input = { readonly path: string }

// A large write would otherwise store its whole content twice: once in the tool input and again in this patch,
// which is durable on the session and sent to every client. The counts and status stay, the renderer falls back
// to its text preview, and the diff viewer is not offered for that card.
const PATCH_LIMIT = 256 * 1024

/**
 * Adds the final diff of every `write` call to its tool result metadata, which the session renderer shows under
 * the file header and in the diff viewer. The core tool returns no diff, so the file is read again here after
 * formatting, rather than reusing the permission preview, which describes the content before the formatter runs.
 *
 * Only a target the tool treats as internal is read before the call, because that read runs before the tool's
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
            const target = resolvePath(ctx.location.directory, input.path)
            const before = internal(ctx.location, target) ? yield* existing(fs, target) : undefined
            const result = yield* execute(input, context)
            if (before === undefined) return result
            const after = yield* read(fs, target)
            if (after === undefined) return result
            const file = fileDiff(resource(ctx.location, target), before.text, after, before.existed ? "modified" : "added")
            return { ...result, metadata: { ...result.metadata, files: [bounded(file)] } } // kilo_port(unattributed:tool:0bc16fea6c47)
          })
      }),
    )
  }),
})

/**
 * The worktree is internal too, as in `FileAccess.resolve`, when it is a real directory rather than a filesystem
 * root. Keeping the rule here avoids the Location-scoped FileAccess service, which the host does not give plugins.
 */
const internal = (location: { directory: string; project: { directory: string } }, target: string) => {
  const worktree = path.resolve(location.project.directory)
  return (
    FSUtil.contains(location.directory, target) ||
    (worktree !== path.parse(worktree).root && FSUtil.contains(worktree, target))
  )
}

/** Drop the patch above the limit so a large write does not store its content twice. */
const bounded = (file: typeof FileDiff.Info.Type): typeof FileDiff.Info.Type =>
  file.patch.length > PATCH_LIMIT ? { ...file, patch: "" } : file

/** The current text and whether the file existed before the write. */
const existing = (
  fs: FSUtil.Interface,
  target: string,
): Effect.Effect<{ readonly text: string; readonly existed: boolean } | undefined> =>
  fs.existsSafe(target).pipe(
    Effect.flatMap((existed): Effect.Effect<{ readonly text: string; readonly existed: boolean } | undefined> =>
      existed
        ? Effect.map(read(fs, target), (text) => (text === undefined ? undefined : { text, existed: true }))
        : Effect.succeed({ text: "", existed: false }),
    ),
  )

/** The resource name the write tool reports: relative to the session directory for an internal target. */
const resource = (location: { directory: string }, target: string) =>
  (path.relative(location.directory, target) || ".").replaceAll("\\", "/")

/** A preview read, so an unreadable file leaves the result without a diff instead of failing the write. */
const read = (fs: FSUtil.Interface, target: string) =>
  fs.readFileStringSafe(target).pipe(
    Effect.map((text) => (text === undefined ? undefined : Bom.split(text).text)),
    Effect.orElseSucceed(() => undefined),
  )
