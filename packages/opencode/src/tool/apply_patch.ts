import * as path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { InstanceState } from "@/effect/instance-state"
import { Patch } from "../patch"
import { createTwoFilesPatch, diffLines } from "diff"
import { assertExternalDirectoryEffect } from "./external-directory"
import { trimDiff } from "./edit"
import { LSP } from "@/lsp/lsp"
import { FSUtil } from "@opencode-ai/core/fs-util"
import DESCRIPTION from "./apply_patch.txt"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { filterDiagnostics } from "./diagnostics" // kilocode_change
import { ConfigValidation } from "../kilocode/config-validation" // kilocode_change
import * as EncodedIO from "../kilocode/tool/encoded-io" // kilocode_change
import { KiloFileGuard } from "@/kilocode/tool/file-guard" // kilocode_change
import { Format } from "../format"
import * as Bom from "@/util/bom"

export const Parameters = Schema.Struct({
  patchText: Schema.String.annotate({ description: "The full patch text that describes all changes to be made" }),
})

export const ApplyPatchTool = Tool.define(
  "apply_patch",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const afs = yield* FSUtil.Service
    const format = yield* Format.Service
    const events = yield* EventV2Bridge.Service

    const run = Effect.fn("ApplyPatchTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      if (!params.patchText) {
        return yield* Effect.fail(new Error("patchText is required"))
      }

      // Parse the patch to get hunks
      let hunks: Patch.Hunk[]
      try {
        const parseResult = Patch.parsePatch(params.patchText)
        hunks = parseResult.hunks
      } catch (error) {
        return yield* Effect.fail(new Error(`apply_patch verification failed: ${error}`))
      }

      if (hunks.length === 0) {
        const normalized = params.patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
        if (normalized === "*** Begin Patch\n*** End Patch") {
          return yield* Effect.fail(new Error("patch rejected: empty patch"))
        }
        return yield* Effect.fail(new Error("apply_patch verification failed: no hunks found"))
      }

      const instance = yield* InstanceState.context
      // kilocode_change start - bind every source and destination before reading patch content
      const plans = new Map<string, KiloFileGuard.Plan>()
      for (const filepath of new Set(
        hunks.flatMap((hunk) => [
          path.resolve(instance.directory, hunk.path),
          ...(hunk.type === "update" && hunk.move_path ? [path.resolve(instance.directory, hunk.move_path)] : []),
        ]),
      )) {
        plans.set(filepath, yield* KiloFileGuard.plan({ ctx: instance, requested: filepath }).pipe(Effect.orDie))
      }
      // kilocode_change end

      // Validate file paths and check permissions
      const fileChanges: Array<{
        filePath: string
        oldContent: string
        newContent: string
        type: "add" | "update" | "delete" | "move"
        movePath?: string
        diff: string
        additions: number
        deletions: number
        bom: boolean
        encoding: string // kilocode_change - preserved per-file encoding
      }> = []

      let totalDiff = ""

      for (const hunk of hunks) {
        const filePath = path.resolve(instance.directory, hunk.path)
        const plan = plans.get(filePath)!
        yield* assertExternalDirectoryEffect(ctx, filePath)

        switch (hunk.type) {
          case "add": {
            const oldContent = ""
            const newContent =
              hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`
            const next = Bom.split(newContent)
            const diff = trimDiff(createTwoFilesPatch(filePath, filePath, oldContent, next.text))

            let additions = 0
            let deletions = 0
            for (const change of diffLines(oldContent, next.text)) {
              if (change.added) additions += change.count || 0
              if (change.removed) deletions += change.count || 0
            }

            fileChanges.push({
              filePath,
              oldContent,
              newContent: next.text,
              type: "add",
              diff,
              additions,
              deletions,
              bom: next.bom,
              encoding: "utf-8", // kilocode_change - new files default to utf-8
            })

            totalDiff += diff + "\n"
            break
          }

          case "update": {
            // Check if file exists for update
            const stats = yield* afs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!stats || stats.type === "Directory") {
              return yield* Effect.fail(
                new Error(`apply_patch verification failed: Failed to read file to update: ${filePath}`),
              )
            }

            // kilocode_change start - encoding-aware read so non-UTF-8 files decode without
            // mojibake; the resulting diff, additions/deletions counts, and permission-prompt
            // metadata shown to the user must reflect the real file contents.
            const bytes = yield* KiloFileGuard.read({ ctx: instance, requested: filePath }).pipe(
              Effect.catch((error) =>
                Effect.fail(
                  new Error(
                    `apply_patch verification failed: ${error instanceof Error ? error.message : String(error)}`,
                  ),
                ),
              ),
            )
            const read = EncodedIO.decode(bytes)
            const source = Bom.split(read.text)
            // kilocode_change end
            const oldContent = source.text
            let newContent = oldContent
            let bom = source.bom
            let encoding = read.encoding // kilocode_change - overwritten by deriveNewContentsFromChunks below

            // Apply the update chunks to get new content
            try {
              const fileUpdate = Patch.deriveNewContentsFromChunks(
                filePath,
                hunk.chunks,
                Bom.join(source.text, source.bom),
              )
              newContent = fileUpdate.content
              bom = fileUpdate.bom
            } catch (error) {
              return yield* Effect.fail(new Error(`apply_patch verification failed: ${error}`))
            }

            const diff = trimDiff(createTwoFilesPatch(filePath, filePath, oldContent, newContent))

            let additions = 0
            let deletions = 0
            for (const change of diffLines(oldContent, newContent)) {
              if (change.added) additions += change.count || 0
              if (change.removed) deletions += change.count || 0
            }

            const movePath = hunk.move_path ? path.resolve(instance.directory, hunk.move_path) : undefined
            yield* assertExternalDirectoryEffect(ctx, movePath)

            fileChanges.push({
              filePath,
              oldContent,
              newContent,
              type: hunk.move_path ? "move" : "update",
              movePath,
              diff,
              additions,
              deletions,
              bom,
              encoding, // kilocode_change
            })

            totalDiff += diff + "\n"
            break
          }

          case "delete": {
            // kilocode_change start - encoding-aware read so non-UTF-8 files decode without corruption
            const bytes = yield* KiloFileGuard.read({ ctx: instance, requested: filePath }).pipe(
              Effect.catch((error) =>
                Effect.fail(
                  new Error(
                    `apply_patch verification failed: ${error instanceof Error ? error.message : String(error)}`,
                  ),
                ),
              ),
            )
            const deleteRead = EncodedIO.decode(bytes)
            const contentToDelete = deleteRead.text
            const source = Bom.split(contentToDelete)
            // kilocode_change end
            const deleteDiff = trimDiff(createTwoFilesPatch(filePath, filePath, contentToDelete, ""))

            const deletions = contentToDelete.split("\n").length

            fileChanges.push({
              filePath,
              oldContent: contentToDelete,
              newContent: "",
              type: "delete",
              diff: deleteDiff,
              additions: 0,
              deletions,
              bom: source.bom,
              encoding: deleteRead.encoding, // kilocode_change
            })

            totalDiff += deleteDiff + "\n"
            break
          }
        }
      }

      // Build per-file metadata for UI rendering (used for both permission and result)
      const files = fileChanges.map((change) => ({
        filePath: change.filePath,
        relativePath: path.relative(instance.worktree, change.movePath ?? change.filePath).replaceAll("\\", "/"),
        type: change.type,
        patch: change.diff,
        additions: change.additions,
        deletions: change.deletions,
        movePath: change.movePath,
      }))

      // Check permissions if needed
      const relativePaths = Array.from(
        new Set(
          fileChanges.flatMap((change) =>
            [change.filePath, change.movePath]
              .filter((filepath): filepath is string => filepath !== undefined)
              .map((filepath) => path.relative(instance.worktree, filepath).replaceAll("\\", "/")),
          ),
        ),
      )
      yield* ctx.ask({
        permission: "edit",
        patterns: relativePaths,
        always: ["*"],
        metadata: {
          filepath: relativePaths.join(", "),
          diff: totalDiff,
          files,
        },
      })

      // kilocode_change start - detect policy or target changes before the first mutation
      for (const plan of plans.values()) yield* KiloFileGuard.revalidate({ ctx: instance, plan }).pipe(Effect.orDie)
      // kilocode_change end

      // Apply the changes
      const updates: Array<{ file: string; event: "add" | "change" | "unlink" }> = []

      for (const change of fileChanges) {
        // kilocode_change start - revalidate each sequential mutation immediately before committing it
        const source = yield* KiloFileGuard.revalidate({ ctx: instance, plan: plans.get(change.filePath)! }).pipe(
          Effect.orDie,
        )
        const destination = change.movePath
          ? yield* KiloFileGuard.revalidate({ ctx: instance, plan: plans.get(change.movePath)! }).pipe(Effect.orDie)
          : undefined
        const edited = change.type === "delete" ? undefined : (destination?.target ?? source.target)
        // kilocode_change end
        switch (change.type) {
          case "add":
            // Create parent directories (recursive: true is safe on existing/root dirs)
            yield* EncodedIO.write(afs, source.target, Bom.join(change.newContent, change.bom), change.encoding) // kilocode_change - encoding-aware write (mkdirs) replaces afs.writeWithDirs
            updates.push({ file: source.target, event: "add" })
            break

          case "update":
            yield* EncodedIO.write(afs, source.target, Bom.join(change.newContent, change.bom), change.encoding) // kilocode_change - encoding-aware write replaces afs.writeWithDirs
            updates.push({ file: source.target, event: "change" })
            break

          case "move":
            if (destination) {
              // Create parent directories (recursive: true is safe on existing/root dirs)
              yield* EncodedIO.write(afs, destination.target, Bom.join(change.newContent, change.bom), change.encoding) // kilocode_change - encoding-aware write (mkdirs) replaces afs.writeWithDirs
              yield* afs.remove(source.target)
              updates.push({ file: source.target, event: "unlink" })
              updates.push({ file: destination.target, event: "add" })
            }
            break

          case "delete":
            yield* afs.remove(source.target)
            updates.push({ file: source.target, event: "unlink" })
            break
        }

        if (edited) {
          if (yield* format.file(edited)) {
            yield* KiloFileGuard.plan({ ctx: instance, requested: edited }).pipe(Effect.orDie)
            yield* EncodedIO.sync(afs, edited, change.bom, change.encoding)
          }
          yield* events.publish(FileSystem.Event.Edited, { file: edited })
        }
      }

      // Publish file change events
      for (const update of updates) {
        yield* events.publish(Watcher.Event.Updated, update)
      }

      // Notify LSP of file changes and collect diagnostics
      for (const change of fileChanges) {
        if (change.type === "delete") continue
        const target = change.movePath ?? change.filePath
        yield* lsp.touchFile(target, "document")
      }
      const diagnostics = yield* lsp.diagnostics()

      // Generate output summary
      const summaryLines = fileChanges.map((change) => {
        if (change.type === "add") {
          return `A ${path.relative(instance.worktree, change.filePath).replaceAll("\\", "/")}`
        }
        if (change.type === "delete") {
          return `D ${path.relative(instance.worktree, change.filePath).replaceAll("\\", "/")}`
        }
        const target = change.movePath ?? change.filePath
        return `M ${path.relative(instance.worktree, target).replaceAll("\\", "/")}`
      })
      let output = `Success. Updated the following files:\n${summaryLines.join("\n")}`

      // kilocode_change start
      const changedPaths = fileChanges
        .filter((c) => c.type !== "delete")
        .map((c) => FSUtil.normalizePath(c.movePath ?? c.filePath))
      // kilocode_change end

      for (const change of fileChanges) {
        if (change.type === "delete") continue
        const target = change.movePath ?? change.filePath
        const block = LSP.Diagnostic.report(target, diagnostics[FSUtil.normalizePath(target)] ?? [])
        if (!block) continue
        const rel = path.relative(instance.worktree, target).replaceAll("\\", "/")
        output += `\n\nLSP errors detected in ${rel}, please fix:\n${block}`
      }

      // kilocode_change start - append Kilo config validation warnings
      for (const changed of fileChanges) {
        if (changed.type === "delete") continue
        output += yield* Effect.promise(() => ConfigValidation.check(changed.movePath ?? changed.filePath))
      }
      // kilocode_change end

      return {
        title: output,
        metadata: {
          diff: totalDiff,
          files,
          diagnostics: filterDiagnostics(diagnostics, changedPaths), // kilocode_change
        },
        output,
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
