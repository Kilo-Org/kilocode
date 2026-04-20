import z from "zod"
import * as path from "path"
import { Effect } from "effect"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Format } from "../format"
import { FileTime } from "../file/time"
import { AppFileSystem } from "../filesystem"
import { Instance } from "../project/instance"
import { trimDiff, buildFileDiff } from "./edit" // kilocode_change
import { assertExternalDirectoryEffect } from "./external-directory"
import { filterDiagnostics } from "./diagnostics" // kilocode_change
import { ConfigValidation } from "../kilocode/config-validation" // kilocode_change

const MAX_PROJECT_DIAGNOSTICS_FILES = 5

export const WriteTool = Tool.define(
  "write",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* AppFileSystem.Service
    const filetime = yield* FileTime.Service
    const bus = yield* Bus.Service
    const format = yield* Format.Service

    return {
      description: DESCRIPTION,
      parameters: z.object({
        content: z.string().describe("The content to write to the file"),
        filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
      }),
      execute: (params: { content: string; filePath: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(Instance.directory, params.filePath)
          yield* assertExternalDirectoryEffect(ctx, filepath)

          const exists = yield* fs.existsSafe(filepath)
          const contentOld = exists ? yield* fs.readFileString(filepath) : ""
          if (exists) yield* filetime.assert(ctx.sessionID, filepath)

          const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))
          const filediff = buildFileDiff(filepath, contentOld, params.content) // kilocode_change
          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(Instance.worktree, filepath)],
            always: ["*"],
            metadata: {
              filepath,
              diff,
              filediff, // kilocode_change
            },
          })

          yield* fs.writeWithDirs(filepath, params.content)
          yield* format.file(filepath)
          yield* bus.publish(File.Event.Edited, { file: filepath })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: filepath,
            event: exists ? "change" : "add",
          })
          yield* filetime.read(ctx.sessionID, filepath)

          let output = "Wrote file successfully."
          yield* lsp.touchFile(filepath, true)
          const diagnostics = yield* lsp.diagnostics()
          const normalizedFilepath = AppFileSystem.normalizePath(filepath)
          let projectDiagnosticsCount = 0
          for (const [file, issues] of Object.entries(diagnostics)) {
            const current = file === normalizedFilepath
            if (!current && projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
            const block = LSP.Diagnostic.report(current ? filepath : file, issues)
            if (!block) continue
            if (current) {
              output += `\n\nLSP errors detected in this file, please fix:\n${block}`
              continue
            }
            projectDiagnosticsCount++
            output += `\n\nLSP errors detected in other files:\n${block}`
          }
          output += yield* Effect.promise(() => ConfigValidation.check(filepath)) // kilocode_change

          return {
            title: path.relative(Instance.worktree, filepath),
            metadata: {
              diagnostics: filterDiagnostics(diagnostics, [normalizedFilepath]), // kilocode_change
              filepath,
              exists: exists,
              diff, // kilocode_change
              filediff, // kilocode_change
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
