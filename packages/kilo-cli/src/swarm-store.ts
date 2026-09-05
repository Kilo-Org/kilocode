import { Effect, Option, Schema, Semaphore } from "effect"

export const SWARM_MAX_MESSAGES = 1_000
export const SWARM_MAX_BODY = 4_096
export const SWARM_MAX_BYTES = 2 * 1024 * 1024
export const SWARM_DEFAULT_LIMIT = 20
export const SWARM_MAX_LIMIT = 50

export type SwarmKind = "INFO" | "ASK" | "RESULT" | "HOLD" | "VETO"
export type SwarmMessage = {
  readonly id: string
  readonly callID: string
  readonly messageID: string
  readonly from: string
  readonly to: string
  readonly type: SwarmKind
  readonly body: string
  readonly replyTo?: string
  readonly time: number
}
type Board = { readonly version: 1; readonly root: string; readonly messages: ReadonlyArray<SwarmMessage> }

const Message = Schema.Struct({
  id: Schema.String,
  callID: Schema.String,
  messageID: Schema.String,
  from: Schema.String,
  to: Schema.String,
  type: Schema.Literals(["INFO", "ASK", "RESULT", "HOLD", "VETO"]),
  body: Schema.String,
  replyTo: Schema.optional(Schema.String),
  time: Schema.Number,
})
const Board = Schema.Struct({
  version: Schema.Literal(1),
  root: Schema.String,
  messages: Schema.Array(Message),
})
const decodeBoard = Schema.decodeUnknownOption(Board)

export type Storage = {
  readonly get: (key: string) => Effect.Effect<unknown>
  readonly set: (key: string, value: Schema.Json) => Effect.Effect<void>
}

const lock = Semaphore.makeUnsafe(1)

export function read(storage: Storage, root: string, input: { readonly since?: string; readonly limit?: number }) {
  return lock.withPermit(
    Effect.gen(function* () {
      const board = yield* load(storage, root)
      const limit = input.limit ?? SWARM_DEFAULT_LIMIT
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > SWARM_MAX_LIMIT)
        return yield* Effect.fail(new Error(`Board read limit must be between 1 and ${SWARM_MAX_LIMIT}`))
      const start =
        input.since === undefined ? 0 : board.messages.findIndex((message) => message.id === input.since) + 1
      if (input.since !== undefined && start === 0)
        return yield* Effect.fail(new Error("Board cursor is not valid for this session"))
      const page = board.messages.slice(start, start + limit)
      return {
        messages: page,
        cursor: page.at(-1)?.id,
        hasMore: start + page.length < board.messages.length,
      }
    }),
  )
}

export function post(storage: Storage, root: string, input: Omit<SwarmMessage, "id" | "time">) {
  return lock.withPermit(
    Effect.gen(function* () {
      if (!input.body.trim() || input.body.length > SWARM_MAX_BODY)
        return yield* Effect.fail(new Error("Board message body must be 1 to 4096 characters"))
      const board = yield* load(storage, root)
      const existing = board.messages.find(
        (message) =>
          message.from === input.from && message.messageID === input.messageID && message.callID === input.callID,
      )
      if (existing) {
        if (
          existing.to !== input.to ||
          existing.type !== input.type ||
          existing.body !== input.body ||
          existing.replyTo !== input.replyTo
        )
          return yield* Effect.fail(new Error("The trusted board tool call was retried with different arguments"))
        return existing
      }
      if (board.messages.length >= SWARM_MAX_MESSAGES)
        return yield* Effect.fail(new Error("Board message limit reached"))
      if (input.replyTo && !board.messages.some((message) => message.id === input.replyTo))
        return yield* Effect.fail(new Error("Reply message is not on this board"))
      const message: SwarmMessage = { ...input, id: `board_${crypto.randomUUID()}`, time: Date.now() }
      if (bytes(board.messages) + bytes([message]) > SWARM_MAX_BYTES)
        return yield* Effect.fail(new Error("Board storage limit reached"))
      yield* storage.set(key(root), { ...board, messages: [...board.messages, message] })
      return message
    }),
  )
}

export function activity(storage: Storage, root: string) {
  return lock.withPermit(Effect.map(load(storage, root), (board) => board.messages.at(-1)?.id))
}

function load(storage: Storage, root: string) {
  return Effect.flatMap(storage.get(key(root)), (value) => {
    if (value === undefined) return Effect.succeed({ version: 1 as const, root, messages: [] })
    const decoded = decodeBoard(value)
    if (Option.isNone(decoded)) return Effect.fail(new Error("Stored Swarm board is malformed"))
    if (decoded.value.root !== root) return Effect.fail(new Error("Stored Swarm board has an invalid root"))
    return Effect.succeed(decoded.value)
  })
}

function key(root: string) {
  return `board:${root}`
}

function bytes(messages: ReadonlyArray<SwarmMessage>) {
  return messages.reduce((total, message) => total + Buffer.byteLength(JSON.stringify(message)), 0)
}
