import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "@/tool/external-directory"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { KiloReadObject } from "@/kilocode/tool/read-object"
import { sniffAttachmentMime } from "@/util/media"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { KiloReference } from "@/kilocode/reference/contains"
import DESCRIPTION from "./send-file.txt"
import path from "node:path"

/**
 * Remote-CLI-only live-connection delivery cap. The send_file path rides the
 * existing tool-attachment transport (remote-sender → UserConnectionDO → mobile
 * SDK), which has no in-repo frame cap. Cloud-agent ingest trims tool-attachment
 * URLs at 1 MiB (`MAX_INGEST_EVENT_BYTES`), so delivery through the cloud-agent
 * path is impossible by design — the tool is gated on `KiloSessions.remoteStatus()
 * .connected`, which is only true for the remote-CLI relay. History/cold-open
 * re-hydration rides the existing R2 spill (>~1.94 MiB) and 8 MiB page budget;
 * near the cap a cold-open "unavailable" is accepted page-pressure behavior.
 */
export const SEND_FILE_MAX_BYTES = 4 * 1024 * 1024

const SAMPLE_BYTES = 4096

const Params = Schema.Struct({
  path: Schema.String.annotate({ description: "Absolute or relative path to the file to send to the mobile app." }),
})

function fail(msg: string) {
  return { title: "Send file failed", output: msg, metadata: {} }
}

export const SendFileTool = Tool.define<typeof Params, {}, FSUtil.Service, "send_file">(
  "send_file",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          if (!KiloSessions.remoteStatus().connected) {
            return fail(
              "Cannot send files: this session is not connected to Kilo cloud. Delivery needs an active link.",
            )
          }

          const inst = yield* InstanceState.context
          const requested = path.resolve(inst.directory, params.path)
          const basename = path.basename(requested)

          // kilocode_change start — authorize missing and directory paths with the same
          // security sequence as read.ts before any file inspection via KiloReadObject.
          // Route absent targets through a read-style authorized failure, and produce a
          // structured fail() for directories. This prevents access-pattern leakage where
          // missing vs directory vs external-directory errors differ before permission
          // checks.
          const info = yield* fs.stat(requested).pipe(
            Effect.catchIf(
              (err) => "reason" in err && err.reason._tag === "NotFound",
              () => Effect.succeed(undefined),
            ),
          )
          if (!info) {
            const dir = path.dirname(requested)
            const parent = yield* fs.realPath(dir).pipe(Effect.option)
            if (parent._tag === "None") return fail(`File not found: ${basename}`)
            yield* assertExternalDirectoryEffect(ctx, parent.value, { bypass: false, kind: "directory" })
            yield* ctx.ask({
              permission: "read",
              patterns: [...new Set([requested, parent.value].map((item) => path.relative(inst.worktree, item)))],
              always: ["*"],
              metadata: {},
            })
            return fail(`File not found: ${basename}`)
          }
          if (info.type === "Directory") {
            const resolved = yield* fs.realPath(requested)
            const target = process.platform === "win32" ? FSUtil.normalizePath(resolved) : resolved
            const explicit =
              typeof ctx.extra?.["referenceRoot"] === "string"
                ? yield* KiloReference.path(fs, ctx.extra["referenceRoot"], target).pipe(
                    Effect.option,
                    Effect.map((result) => result._tag === "Some" && result.value),
                  )
                : false
            yield* assertExternalDirectoryEffect(ctx, target, { bypass: explicit, kind: "directory" })
            yield* ctx.ask({
              permission: "read",
              patterns: [...new Set([requested, target].map((item) => path.relative(inst.worktree, item)))],
              always: ["*"],
              metadata: {},
            })
            return fail(`Cannot send: ${basename} is a directory.`)
          }
          // kilocode_change end

          // 1. Resolve via KiloReadObject.file (same authorization sequence as read.ts)
          const file = yield* KiloReadObject.file(requested)

          // 2. Authorization — same pattern as read.ts
          const explicit =
            typeof ctx.extra?.["referenceRoot"] === "string"
              ? yield* KiloReference.path(fs, ctx.extra["referenceRoot"], file.target).pipe(
                  Effect.option,
                  Effect.map((result) => result._tag === "Some" && result.value),
                )
              : false
          yield* assertExternalDirectoryEffect(ctx, file.target, { bypass: explicit, kind: "file" })
          yield* ctx.ask({
            permission: "read",
            patterns: [...new Set([requested, file.target].map((item) => path.relative(inst.worktree, item)))],
            always: ["*"],
            metadata: {},
          })

          // 3. Size check before reading content
          if (Number(file.stat.size) > SEND_FILE_MAX_BYTES) {
            return {
              title: "Send file too large",
              output: `Cannot send: ${basename} is ${file.stat.size} bytes, which exceeds the ${SEND_FILE_MAX_BYTES / (1024 * 1024)} MiB limit. For larger files, give the user the workspace path instead.`,
              metadata: {},
            }
          }

          // 4. Open and read with TOCTOU safety (same pattern as read.ts)
          return yield* KiloReadObject.use(file, (bound) =>
            Effect.gen(function* () {
              const sample = yield* Effect.tryPromise({
                try: (signal) => bound.sample(SAMPLE_BYTES, AbortSignal.any([ctx.abort, signal])),
                catch: (err) => (err instanceof Error ? err : new Error(String(err))),
              })
              const mime = sniffAttachmentMime(sample, FSUtil.mimeType(requested))

              const bytes = yield* Effect.tryPromise({
                try: (signal) => bound.read(SEND_FILE_MAX_BYTES + 1, AbortSignal.any([ctx.abort, signal])),
                catch: (err) => (err instanceof Error ? err : new Error(String(err))),
              })
              if (bytes.byteLength > SEND_FILE_MAX_BYTES) {
                return {
                  title: "Send file too large",
                  output: `Cannot send: ${basename} exceeds the ${SEND_FILE_MAX_BYTES / (1024 * 1024)} MiB limit. For larger files, give the user the workspace path instead.`,
                  metadata: {},
                }
              }

              return {
                title: `Sent file: ${basename}`,
                output: `File ${basename} (${bytes.byteLength} bytes, ${mime}) delivered to the user's Kilo app. Older app builds ignore non-image file attachments — make sure the user has an up-to-date app to see the delivery.`,
                metadata: {},
                attachments: [
                  {
                    type: "file" as const,
                    mime,
                    filename: basename,
                    url: `data:${mime};base64,${bytes.toString("base64")}`,
                  },
                ],
              }
            }),
          )
        }).pipe(Effect.orDie),
    }
  }),
)
