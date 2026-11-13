import type { AssertInput } from "@opencode/plugin/permission"
import type { SessionID } from "@opencode/schema/session-id"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import POST_DESCRIPTION from "./board_post.txt"
import READ_DESCRIPTION from "./board_read.txt"
import { BoardStore } from "./store"

export const DISABLED = "The shared agent board is disabled. Enable Kilo Swarm in Agent Behaviour settings."

export interface Runtime {
  readonly store: BoardStore.Runtime
  readonly enabled: Effect.Effect<boolean>
  readonly permission: { readonly assert: (input: AssertInput) => Effect.Effect<void, Tool.Error> }
  /** Publishes the board's new revision after a post. */
  readonly changed: (sessionID: SessionID) => Effect.Effect<void>
}

const Read = Schema.Struct({
  since: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description:
      "Cursor from your last board_read, not an ID from board_post. Omit or send null to start at the beginning.",
  }),
  limit: Schema.optional(Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })))).annotate({
    description: "Maximum messages to return. Omit or send null for the default of 20.",
  }),
})

const Post = Schema.Struct({
  to: Schema.String.annotate({
    description:
      "A known participant ID from subagent or board_read; your own row is flagged self: true (the main row is the board root), and a post to yourself is refused. ALL is for team-wide updates.",
  }),
  type: BoardStore.Kind,
  body: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  reply_to: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "ID of a message on this board being replied to. Omit or send null for a new note.",
  }),
})

export function makeTools(runtime: Runtime) {
  const read: Tool.Info<typeof Read> = {
    name: "board_read",
    // Direct calls keep the client rendering and board detection; the same tool is also callable as
    // `tools.board_read` inside `execute`, because a Code Mode program cannot reach a direct tool.
    options: { direct: true },
    description: READ_DESCRIPTION.trim(),
    input: Read,
    execute: (params, context) =>
      Effect.gen(function* () {
        yield* guard(runtime)
        yield* runtime.permission.assert({
          sessionID: context.sessionID,
          agent: context.agent,
          action: "board_read",
          resources: ["*"],
          save: ["*"],
          metadata: {},
          source: { type: "tool", messageID: context.messageID, id: context.id },
        })
        const since = params.since?.trim()
        const result = yield* BoardStore.read(runtime.store, {
          sessionID: context.sessionID,
          ...(since ? { since } : {}),
          ...(params.limit == null ? {} : { limit: params.limit }),
        }).pipe(Effect.mapError(toolError))
        return {
          content: JSON.stringify(result),
          metadata: {
            title: "Shared agent board",
            ...(result.cursor === undefined ? {} : { cursor: result.cursor }),
            hasMore: result.hasMore,
            truncated: false,
            participants: result.participants,
            participantsTruncated: result.participantsTruncated ?? false,
            observedAt: result.observedAt,
            ...(result.recovered ? { recovered: true } : {}),
          },
        }
      }),
  }

  const post: Tool.Info<typeof Post> = {
    name: "board_post",
    options: { direct: true },
    description: POST_DESCRIPTION.trim(),
    input: Post,
    execute: (params, context) =>
      Effect.gen(function* () {
        yield* guard(runtime)
        yield* runtime.permission.assert({
          sessionID: context.sessionID,
          agent: context.agent,
          action: "board_post",
          resources: ["*"],
          save: ["*"],
          metadata: { to: params.to, type: params.type },
          source: { type: "tool", messageID: context.messageID, id: context.id },
        })
        const reply = params.reply_to?.trim()
        const message = yield* BoardStore.post(runtime.store, {
          sessionID: context.sessionID,
          messageID: context.messageID,
          callID: context.id,
          to: params.to,
          type: params.type,
          body: params.body,
          ...(reply ? { reply_to: reply } : {}),
        }).pipe(Effect.mapError(toolError))
        yield* runtime.changed(context.sessionID)
        const availability = yield* BoardStore.availability(runtime.store, {
          sessionID: context.sessionID,
          to: message.to,
        }).pipe(Effect.mapError(toolError))
        const warning = warn(availability)
        return {
          content: JSON.stringify({
            ...message,
            availability,
            receipt: "Stored only. This does not confirm delivery, reading, or action, and does not wake recipients.",
            ...(warning ? { warning } : {}),
          }),
          metadata: {
            title: `${message.type} to ${message.to}`,
            id: message.id,
            from: message.from,
            to: message.to,
            ...(message.fromLabel === undefined ? {} : { fromLabel: message.fromLabel }),
            ...(message.toLabel === undefined ? {} : { toLabel: message.toLabel }),
            type: message.type,
            availability,
            truncated: false,
          },
        }
      }),
  }

  return { read, post }
}

function guard(runtime: Runtime) {
  return runtime.enabled.pipe(
    Effect.flatMap((enabled) => (enabled ? Effect.void : Effect.fail(new Tool.Error({ message: DISABLED })))),
  )
}

function toolError(error: BoardStore.Failure | BoardStore.Conflict) {
  return new Tool.Error({ message: error.message, error })
}

function warn(availability: BoardStore.Availability) {
  const state = availability.recipientState
  if (state === "unknown")
    return "The direct recipient's execution state was unknown at this post attempt. Do not assume it is running or will read this message. This post is stored only and does not wake or resume the recipient. Do not resume it just to deliver this note."
  if (state === "completed" || state === "error" || state === "cancelled")
    return `The direct recipient's state was ${state} at this post attempt. Its invocation has ended; do not expect a reply to this message. This post is stored only and does not wake or resume the recipient. Do not resume it just to deliver this note.`
  return [
    availability.total > 0 &&
      availability.active === 0 &&
      availability.unknown === 0 &&
      "No other recipients were active at this post attempt.",
    availability.inactive > 0 && `${availability.inactive} recipient(s) had finished invocations at this post attempt.`,
    availability.unknown > 0 && `Availability was unknown for ${availability.unknown} recipient(s) at this post attempt.`,
  ]
    .filter(Boolean)
    .join(" ")
}
