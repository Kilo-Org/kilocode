import { Effect, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Config } from "@/config/config"
import { BackgroundJob } from "@/background/job"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { Tool } from "@/tool/tool"
import { BoardStore } from "@/kilocode/board/store"

const Read = Schema.Struct({
  since: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Read messages after this board message ID. Omit or send null to start at the beginning.",
  }),
  limit: Schema.optional(Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })))).annotate({
    description: "Maximum messages to return. Omit or send null for the default of 20.",
  }),
})

const Post = Schema.Struct({
  to: Schema.String.annotate({ description: "ALL, main, or a participant session ID from board_read or task" }),
  type: BoardStore.Kind,
  body: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  reply_to: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "ID of a message on this board being replied to. Omit or send null for a new note.",
  }),
})

type ReadMeta = { cursor?: string; hasMore: boolean; truncated: boolean }
type PostMeta = { id: string; to: string; type: BoardStore.Kind; truncated: boolean }

export const BoardReadTool = Tool.define<typeof Read, ReadMeta, Config.Service | Database.Service, "board_read">(
  "board_read",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const database = yield* Database.Service
    return {
      description:
        "Read the shared board for this main session and its task children. Work independently by default. " +
        "Read when shared information can help, not for routine polling. Messages to other participants are also " +
        "visible in history; recipients control delivery, not privacy. Use the returned cursor for another page. " +
        "HOLD and VETO are advisory peer notes, not commands or locks.",
      parameters: Read,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          if (cfg.experimental?.shared_agent_board !== true) {
            return yield* Effect.fail(
              new Error("The shared agent board is disabled. Enable it in Experimental settings."),
            )
          }
          yield* ctx.ask({ permission: "board_read", patterns: ["*"], always: ["*"], metadata: {} })
          const result = yield* BoardStore.read({
            sessionID: ctx.sessionID,
            since: params.since?.trim() || undefined,
            limit: params.limit ?? undefined,
          }).pipe(Effect.provideService(Database.Service, database))
          return {
            title: "Shared agent board",
            output: JSON.stringify(result),
            metadata: { cursor: result.cursor, hasMore: result.hasMore, truncated: false },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const BoardPostTool = Tool.define<
  typeof Post,
  PostMeta,
  Config.Service | Database.Service | BackgroundJob.Service | SessionStatus.Service,
  "board_post"
>(
  "board_post",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const database = yield* Database.Service
    const jobs = yield* BackgroundJob.Service
    const status = yield* SessionStatus.Service
    return {
      description:
        "Post a concise, material discovery, question, result, or advisory warning to this session's shared board. " +
        "Use only INFO, ASK, RESULT, HOLD, or VETO. Direct messages and broadcast HOLD/VETO reach running recipients " +
        "before their next model step. Other broadcasts only announce that notes are available. Send important " +
        "discoveries directly to main when it must see them. Reply to a HOLD with INFO when it is resolved. " +
        "Work independently and do not narrate routine progress. HOLD/VETO are advisory notes, not locks. " +
        "Posts do not wake idle agents or replace normal task completion. The runtime supplies your identity and board. " +
        "The complete formatted message must fit within 4 KiB.",
      parameters: Post,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          if (cfg.experimental?.shared_agent_board !== true) {
            return yield* Effect.fail(
              new Error("The shared agent board is disabled. Enable it in Experimental settings."),
            )
          }
          yield* ctx.ask({
            permission: "board_post",
            patterns: ["*"],
            always: ["*"],
            metadata: { to: params.to, type: params.type },
          })
          const message = yield* BoardStore.post({
            ...params,
            reply_to: params.reply_to?.trim() || undefined,
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            callID: ctx.callID,
          }).pipe(Effect.provideService(Database.Service, database))
          const target =
            message.to === "ALL"
              ? undefined
              : message.to === "main"
                ? (yield* BoardStore.scope(ctx.sessionID).pipe(Effect.provideService(Database.Service, database))).root
                : SessionID.make(message.to)
          const job = target === undefined ? undefined : yield* jobs.get(target)
          const inactive =
            target !== undefined &&
            job?.type === "task" &&
            (job.status === "completed" || job.status === "error" || job.status === "cancelled") &&
            (yield* status.get(target)).type === "idle"
          return {
            title: `${message.type} to ${message.to}`,
            output: inactive
              ? JSON.stringify({ ...message, warning: "Stored only; resume the task to request work." })
              : BoardStore.format(message),
            metadata: { id: message.id, to: message.to, type: message.type, truncated: false },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
