export * as BoardStore from "./store"

import type { StorageDomain } from "@opencode/plugin/effect/storage"
import { KiloBoardRpc } from "@opencode/schema/kilocode/board"
import { SessionID } from "@opencode/schema/session-id"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Option, Schema, Semaphore } from "effect"
import { randomUUID } from "node:crypto"

// The board of one main session and its subagents lives in the plugin's key/value storage, keyed by the root session:
//   board/<root>/meta             counters (next_seq, cleared_seq, message_count, message_bytes)
//   board/<root>/m/<seq>          one message, seq zero-padded so a prefix scan returns them in order
//   board/<root>/id/<message id>  seq of a message, for cursors and replies
//   board/<root>/call/<identity>  seq of a post, keyed by sender, source message and tool call, for retries
// Writes of one board are serialized in this process, so parallel posts keep seq order and the limits.

const MAX_MESSAGE = 4 * 1024
const MAX_MESSAGES = 1_000
const MAX_BYTES = 2 * 1024 * 1024
const MAX_READ = 32 * 1024
const MAX_ROSTER = 50
const READ_RESERVE = MAX_MESSAGE + 2048
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_LABEL = 512
const ALL = "ALL"
const TRUNCATED = "[truncated]"
const SEQ_WIDTH = 12

export const Kind = KiloBoardRpc.Kind
export type Kind = KiloBoardRpc.Kind
export type Message = KiloBoardRpc.Message
export type Board = KiloBoardRpc.Board

export type State = "running" | "busy" | "retry" | "offline" | "completed" | "error" | "cancelled" | "unknown"

export type Execution = {
  state: State
  updated?: number
}

export type Snapshot = {
  observedAt: number
  sessions: ReadonlyMap<string, Execution>
}

export type Participant = {
  id: string
  sessionID: string
  label: string
  agent?: string
  state: State
  /** Set on the reading session's own row, so an agent can tell that a prospective recipient is itself. */
  self?: boolean
}

/** The session fields the board needs. */
export type Member = {
  id: string
  parentID?: string
  projectID: string
  directory: string
  title?: string
  agent?: string
  created: number
}

export interface Runtime {
  readonly storage: Pick<StorageDomain, "get" | "set" | "scan">
  readonly session: (sessionID: string) => Effect.Effect<Member | undefined>
  /** Direct children of a session, every page. */
  readonly children: (sessionID: string) => Effect.Effect<readonly Member[]>
  /** Execution state of the given sessions now. */
  readonly execution: (sessionIDs: readonly string[]) => Effect.Effect<Snapshot>
}

export class Failure extends Schema.TaggedError<Failure>()("BoardStore.Failure", {
  message: Schema.String,
  kind: Schema.optional(Schema.Literals(["not_found", "storage"])),
}) {}

export class Conflict extends Schema.TaggedError<Conflict>()("BoardStore.Conflict", {
  message: Schema.String,
}) {}

const Meta = Schema.Struct({
  next_seq: Schema.Int,
  cleared_seq: Schema.Int,
  message_count: Schema.Int,
  message_bytes: Schema.Int,
})
type Meta = typeof Meta.Type

const Row = Schema.Struct({
  id: Schema.String,
  seq: Schema.Int,
  time_created: Schema.Int,
  sender: Schema.String,
  recipient: Schema.String,
  type: Kind,
  body: Schema.String,
  reply_to: Schema.optional(Schema.String),
  source_message_id: Schema.String,
  source_call_id: Schema.String,
})
type Row = typeof Row.Type

const decodeMeta = Schema.decodeUnknownOption(Meta)
const decodeRow = Schema.decodeUnknownOption(Row)
const decodeSeq = Schema.decodeUnknownOption(Schema.Int)

type Line = { root: string; current: Member }

export type ReadResult = {
  observedAt: number
  agent: string
  participants: Participant[]
  messages: Message[]
  cursor?: string
  hasMore: boolean
  participantsTruncated?: boolean
  recovered?: boolean
}

export type Availability = {
  observedAt: number
  total: number
  active: number
  inactive: number
  unknown: number
  recipientState?: State
}

const locks = new Map<string, { semaphore: Semaphore.Semaphore; refs: number }>()

/** The board root of a session and its current revision. */
export const head = Effect.fn("BoardStore.head")(function* (runtime: Runtime, sessionID: string) {
  const line = yield* walk(runtime, sessionID)
  const board = yield* meta(runtime, line.root)
  return { root: SessionID.make(line.root), revision: board ? board.next_seq - 1 : 0 }
})

/** The newest page of a board, read-only: an unknown board reads as empty and is not created. */
export const observe = Effect.fn("BoardStore.observe")(function* (
  runtime: Runtime,
  input: { sessionID: string; directory: string; before?: string; limit?: number },
) {
  const limit = yield* checkLimit(input.limit)
  const line = yield* walk(runtime, input.sessionID)
  yield* routed(line, input.directory)
  return yield* view(runtime, line.root, input.before, limit)
})

/** Clears the visible messages. Only the root session may reset its board, at the revision it last saw. */
export const reset = Effect.fn("BoardStore.reset")(function* (
  runtime: Runtime,
  input: { sessionID: string; directory: string; revision: number },
) {
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) return yield* fail("Board revision is invalid")
  const line = yield* walk(runtime, input.sessionID)
  if (line.root !== input.sessionID) return yield* fail("Only the owning session can reset this board")
  yield* routed(line, input.directory)
  return yield* locked(
    line.root,
    Effect.gen(function* () {
      const board = yield* meta(runtime, line.root)
      if (input.revision !== (board ? board.next_seq - 1 : 0))
        return yield* new Conflict({ message: "The board changed. Refresh it before clearing messages." })
      if (board)
        yield* runtime.storage.set(key.meta(line.root), {
          ...board,
          cleared_seq: input.revision,
          message_count: 0,
          message_bytes: 0,
        })
      return yield* view(runtime, line.root, undefined, DEFAULT_LIMIT)
    }),
  )
})

export const read = Effect.fn("BoardStore.read")(function* (
  runtime: Runtime,
  input: { sessionID: string; since?: string; limit?: number },
) {
  const limit = yield* checkLimit(input.limit)
  const line = yield* walk(runtime, input.sessionID)
  const board = yield* meta(runtime, line.root)
  const since = yield* lookup(runtime, line.root, input.since)
  const stale = input.since !== undefined && since === undefined
  if (stale)
    yield* Effect.logWarning("recovering shared board read from invalid cursor", {
      cursor: input.since,
      root: line.root,
      sessionID: input.sessionID,
    })
  const start = Math.max(since ?? 0, board?.cleared_seq ?? 0)
  const rows = yield* range(runtime, line.root, start, board?.next_seq ?? 1, limit + 1)
  const members = yield* family(runtime, line.root)
  const labels = titles(line.root, members)
  const snapshot = yield* runtime.execution(members.map((member) => member.id))
  const roster = participants(line.root, input.sessionID, members, snapshot)
  return yield* pack({
    observedAt: snapshot.observedAt,
    agent: line.current.id === line.root ? "main" : line.current.id,
    participants: roster.rows,
    participantsTruncated: roster.truncated,
    messages: rows.map((row) => enrich(message(row, line.root), labels)),
    limit,
    since: stale ? undefined : input.since,
    recovered: stale,
  })
})

export const post = Effect.fn("BoardStore.post")(function* (
  runtime: Runtime,
  input: {
    sessionID: string
    messageID: string
    callID?: string
    to: string
    type: Kind
    body: string
    reply_to?: string
  },
) {
  const invalid = validatePost(input)
  if (invalid) return yield* fail(invalid)
  const line = yield* walk(runtime, input.sessionID)
  const target = yield* recipient(runtime, input.to, line.root)
  if (target.id !== ALL && target.id === input.sessionID)
    return yield* fail(
      `Board messages cannot be sent to yourself${input.to === "main" ? ": `main` resolves to the board root, which is your own session" : ": that session is your own"}. Notes addressed to yourself belong in your final response (or goal report) instead of a board post`,
    )
  const labels = titles(line.root, target.member ? [line.current, target.member] : [line.current])
  const call = input.callID ?? ""
  return yield* locked(
    line.root,
    Effect.gen(function* () {
      const identity = key.call(line.root, input.sessionID, input.messageID, call)
      const retried = Option.getOrUndefined(decodeSeq(yield* runtime.storage.get(identity)))
      const existing = retried === undefined ? undefined : yield* row(runtime, line.root, retried)
      if (existing) {
        if (
          existing.recipient !== target.id ||
          existing.type !== input.type ||
          existing.body !== input.body ||
          existing.reply_to !== input.reply_to
        )
          return yield* fail("The trusted board tool call was retried with different arguments")
        return enrich(message(existing, line.root), labels)
      }

      if (input.reply_to && (yield* lookup(runtime, line.root, input.reply_to)) === undefined)
        return yield* fail("Reply message is not on this board")

      const value: Message = {
        id: `board_${randomUUID()}`,
        timestamp: Date.now(),
        from: input.sessionID === line.root ? "main" : input.sessionID,
        to: target.id === ALL ? ALL : target.id === line.root ? "main" : target.id,
        type: input.type,
        body: input.body,
        ...(input.reply_to ? { reply_to: input.reply_to } : {}),
      }
      const bytes = Buffer.byteLength(format(value))
      if (bytes > MAX_MESSAGE) return yield* fail(`Formatted board message exceeds ${MAX_MESSAGE} bytes`)

      const board = (yield* meta(runtime, line.root)) ?? { next_seq: 1, cleared_seq: 0, message_count: 0, message_bytes: 0 }
      if (board.message_count >= MAX_MESSAGES) return yield* fail("Board message limit reached")
      if (board.message_bytes + bytes > MAX_BYTES) return yield* fail("Board storage limit reached")

      const seq = board.next_seq
      const stored: Row = {
        id: value.id,
        seq,
        time_created: value.timestamp,
        sender: input.sessionID,
        recipient: target.id,
        type: input.type,
        body: input.body,
        ...(input.reply_to ? { reply_to: input.reply_to } : {}),
        source_message_id: input.messageID,
        source_call_id: call,
      }
      // The message and its indexes first, the counters last: a write cut short leaves the seq free for the next post.
      yield* runtime.storage.set(key.message(line.root, seq), stored)
      yield* runtime.storage.set(key.id(line.root, value.id), seq)
      yield* runtime.storage.set(identity, seq)
      yield* runtime.storage.set(key.meta(line.root), {
        ...board,
        next_seq: seq + 1,
        message_count: board.message_count + 1,
        message_bytes: board.message_bytes + bytes,
      })
      return enrich(value, labels)
    }),
  )
})

/**
 * The newest message for this session (direct or `ALL`, from another sender) after `after`, and the board's latest
 * seq. A board_read cursor in `read` counts as consumed.
 */
export const activity = Effect.fn("BoardStore.activity")(function* (
  runtime: Runtime,
  input: { sessionID: string; after: number; read?: string },
) {
  if (!Number.isSafeInteger(input.after) || input.after < 0)
    return yield* fail("Board activity sequence must be a non-negative integer")
  const line = yield* walk(runtime, input.sessionID)
  const board = yield* meta(runtime, line.root)
  if (!board) return { cursor: input.after, message: 0 }
  const consumed = (yield* lookup(runtime, line.root, input.read)) ?? 0
  const start = Math.max(input.after, board.cleared_seq, consumed)
  const rows = yield* range(runtime, line.root, start, board.next_seq, MAX_MESSAGES)
  const latest = rows
    .filter((row) => row.sender !== input.sessionID && (row.recipient === input.sessionID || row.recipient === ALL))
    .reduce((max, row) => Math.max(max, row.seq), 0)
  return { cursor: Math.max(input.after, board.next_seq - 1), message: latest }
})

/** How many participants other than the sender could be reached by a post to `to` at this moment. */
export const availability = Effect.fn("BoardStore.availability")(function* (
  runtime: Runtime,
  input: { sessionID: string; to: string; snapshot?: Snapshot },
) {
  const line = yield* walk(runtime, input.sessionID)
  const members = yield* family(runtime, line.root)
  const snapshot = input.snapshot ?? (yield* runtime.execution(members.map((member) => member.id)))
  const target = input.to === "main" ? line.root : input.to
  const counted = members.filter((member) => member.id !== input.sessionID && (target === ALL || member.id === target))
  const states = counted.map((member) => snapshot.sessions.get(member.id)?.state ?? "unknown")
  const active = states.filter(available).length
  const inactive = states.filter((state) => state !== "unknown" && !available(state)).length
  return {
    observedAt: snapshot.observedAt,
    total: counted.length,
    active,
    inactive,
    unknown: counted.length - active - inactive,
    ...(target === ALL ? {} : { recipientState: snapshot.sessions.get(target)?.state ?? "unknown" }),
  } satisfies Availability
})

export function format(value: Message) {
  return JSON.stringify({
    id: value.id,
    timestamp: value.timestamp,
    from: value.from,
    to: value.to,
    type: value.type,
    body: value.body,
    ...(value.reply_to === undefined ? {} : { reply_to: value.reply_to }),
  })
}

export function excerpt(text: string, bytes = 2048) {
  if (bytes <= 0) return ""
  if (Buffer.byteLength(text) <= bytes) return text
  if (Buffer.byteLength(TRUNCATED) >= bytes) return take(TRUNCATED, bytes)
  return take(text, bytes - Buffer.byteLength(TRUNCATED)) + TRUNCATED
}

function take(text: string, bytes: number) {
  const out: string[] = []
  const size = { value: 0 }
  for (const char of text) {
    const next = Buffer.byteLength(char)
    if (size.value + next > bytes) break
    out.push(char)
    size.value += next
  }
  return out.join("")
}

const key = {
  meta: (root: string) => `board/${root}/meta`,
  message: (root: string, seq: number) => `board/${root}/m/${String(seq).padStart(SEQ_WIDTH, "0")}`,
  messages: (root: string) => `board/${root}/m/`,
  id: (root: string, id: string) => `board/${root}/id/${id}`,
  call: (root: string, sender: string, messageID: string, call: string) =>
    `board/${root}/call/${JSON.stringify([sender, messageID, call])}`,
}

function locked<A, E, R>(root: string, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const entry = locks.get(root) ?? { semaphore: Semaphore.makeUnsafe(1), refs: 0 }
      entry.refs++
      locks.set(root, entry)
      return entry
    }),
    (entry) => entry.semaphore.withPermits(1)(effect),
    (entry) =>
      Effect.sync(() => {
        entry.refs--
        if (entry.refs === 0 && locks.get(root) === entry) locks.delete(root)
      }),
  )
}

function meta(runtime: Runtime, root: string) {
  return runtime.storage.get(key.meta(root)).pipe(Effect.map((value) => Option.getOrUndefined(decodeMeta(value))))
}

function row(runtime: Runtime, root: string, seq: number) {
  return runtime.storage
    .get(key.message(root, seq))
    .pipe(Effect.map((value) => Option.getOrUndefined(decodeRow(value))))
}

/** The seq of a message on this board, or undefined when the ID is absent or not on this board. */
function lookup(runtime: Runtime, root: string, id: string | undefined) {
  if (id === undefined) return Effect.succeed(undefined)
  return Effect.gen(function* () {
    const seq = Option.getOrUndefined(decodeSeq(yield* runtime.storage.get(key.id(root, id))))
    if (seq === undefined) return undefined
    const stored = yield* row(runtime, root, seq)
    return stored?.id === id ? seq : undefined
  })
}

/** Messages with `after < seq < before`, oldest first, at most `limit`. */
function range(runtime: Runtime, root: string, after: number, before: number, limit: number) {
  const prefix = key.messages(root)
  const page = (cursor: string, rest: number): Effect.Effect<Row[]> =>
    runtime.storage.scan({ prefix, after: cursor, limit: Math.min(rest, MAX_MESSAGES) }).pipe(
      Effect.flatMap((result) => {
        const rows = result.entries.flatMap((entry) => {
          const decoded = Option.getOrUndefined(decodeRow(entry.value))
          return decoded && decoded.seq > after && decoded.seq < before ? [decoded] : []
        })
        const last = result.entries.at(-1)
        const done = !result.next || !last || rows.length >= rest || rows.length < result.entries.length
        if (done) return Effect.succeed(rows.slice(0, rest))
        return page(last.key, rest - rows.length).pipe(Effect.map((more) => [...rows, ...more]))
      }),
    )
  if (before - after <= 1 || limit <= 0) return Effect.succeed([] as Row[])
  return page(key.message(root, after), limit)
}

function view(runtime: Runtime, root: string, before: string | undefined, limit: number) {
  return Effect.gen(function* () {
    const board = yield* meta(runtime, root)
    const upper = yield* lookup(runtime, root, before)
    if (before !== undefined && upper === undefined) return yield* fail(`Board cursor is not valid for session ${root}`)
    const end = Math.min(upper ?? Infinity, board?.next_seq ?? 1)
    const cleared = board?.cleared_seq ?? 0
    const rows = yield* range(runtime, root, Math.max(cleared, end - limit - 2), end, limit + 1)
    const labels = titles(root, yield* family(runtime, root))
    const page = yield* pack({
      observedAt: Date.now(),
      agent: root,
      participants: [],
      participantsTruncated: false,
      messages: rows.toReversed().map((item) => enrich(message(item, root), labels)),
      limit,
    })
    return {
      ownerSessionID: SessionID.make(root),
      revision: board ? board.next_seq - 1 : 0,
      messages: page.messages.toReversed(),
      hasMore: page.hasMore,
      ...(page.hasMore && page.cursor ? { cursor: page.cursor } : {}),
    } satisfies Board
  })
}

function walk(runtime: Runtime, sessionID: string) {
  return Effect.gen(function* () {
    const current = yield* runtime.session(sessionID)
    if (!current) return yield* fail(`Session not found: ${sessionID}`, "not_found")
    return yield* ascend(runtime, current, current, new Set())
  })
}

function ascend(runtime: Runtime, start: Member, node: Member, seen: Set<string>): Effect.Effect<Line, Failure> {
  if (seen.has(node.id)) return fail(`Session lineage is cyclic: ${start.id}`)
  seen.add(node.id)
  const parentID = node.parentID
  if (!parentID) return Effect.succeed({ root: node.id, current: start })
  return runtime.session(parentID).pipe(
    Effect.flatMap((parent) => {
      if (!parent) return fail(`Session lineage parent is missing: ${parentID}`)
      if (parent.projectID !== node.projectID || parent.directory !== node.directory)
        return fail(`Session lineage crosses a project or worktree boundary: ${start.id}`)
      return ascend(runtime, start, parent, seen)
    }),
  )
}

function routed(line: Line, directory: string) {
  if (!line.current.directory || !directory || FSUtil.resolve(line.current.directory) !== FSUtil.resolve(directory))
    return fail("Session is not in the routed directory")
  return Effect.void
}

/** The root and every descendant in the root's project and directory. */
function family(runtime: Runtime, root: string) {
  return Effect.gen(function* () {
    const top = yield* runtime.session(root)
    if (!top) return []
    const seen = new Set([top.id])
    const descend = (parent: Member): Effect.Effect<Member[]> =>
      runtime.children(parent.id).pipe(
        Effect.map((children) =>
          children.filter(
            (child) =>
              !seen.has(child.id) && child.projectID === parent.projectID && child.directory === parent.directory,
          ),
        ),
        Effect.tap((children) => Effect.sync(() => children.forEach((child) => seen.add(child.id)))),
        Effect.flatMap((children) =>
          Effect.forEach(children, (child) => descend(child).pipe(Effect.map((rest) => [child, ...rest]))),
        ),
        Effect.map((groups) => groups.flat()),
      )
    return [top, ...(yield* descend(top))]
  })
}

function recipient(runtime: Runtime, value: string, root: string) {
  if (value === ALL) return Effect.succeed({ id: ALL, member: undefined })
  const id = value === "main" ? root : value
  return walk(runtime, id).pipe(
    Effect.flatMap((line) =>
      line.root === root
        ? Effect.succeed({ id, member: line.current })
        : fail(`Board recipient is not a participant in this board: ${value}`),
    ),
  )
}

function titles(root: string, members: readonly Member[]) {
  return new Map(
    members.flatMap((member) =>
      member.title === undefined ? [] : [[member.id === root ? "main" : member.id, excerpt(member.title, MAX_LABEL)]],
    ),
  )
}

function enrich(value: Message, labels: ReadonlyMap<string, string>): Message {
  const from = labels.get(value.from)
  const to = value.to === ALL ? undefined : labels.get(value.to)
  return {
    ...value,
    ...(from === undefined ? {} : { fromLabel: from }),
    ...(to === undefined ? {} : { toLabel: to }),
  }
}

function message(value: Row, root: string): Message {
  return {
    id: value.id,
    timestamp: value.time_created,
    from: value.sender === root ? "main" : value.sender,
    to: value.recipient === ALL ? ALL : value.recipient === root ? "main" : value.recipient,
    type: value.type,
    body: value.body,
    ...(value.reply_to ? { reply_to: value.reply_to } : {}),
  }
}

function available(state: State) {
  return state === "running" || state === "busy" || state === "retry" || state === "offline"
}

/** Root first, then the reader, then active participants by latest update, then newest sessions. */
function participants(root: string, self: string, members: readonly Member[], snapshot: Snapshot) {
  const rank = (member: Member) => (member.id === root ? 0 : member.id === self ? 1 : 2)
  const updated = (member: Member) => {
    const execution = snapshot.sessions.get(member.id)
    return execution && available(execution.state) ? (execution.updated ?? 0) : -1
  }
  const sorted = members.toSorted(
    (a, b) =>
      rank(a) - rank(b) ||
      updated(b) - updated(a) ||
      b.created - a.created ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  )
  return {
    rows: sorted.slice(0, MAX_ROSTER).map(
      (member): Participant => ({
        id: member.id === root ? "main" : member.id,
        sessionID: member.id,
        label: excerpt(member.title ?? "", MAX_LABEL),
        ...(member.agent ? { agent: excerpt(member.agent, 128) } : {}),
        state: snapshot.sessions.get(member.id)?.state ?? "unknown",
        ...(member.id === self ? { self: true } : {}),
      }),
    ),
    truncated: sorted.length > MAX_ROSTER,
  }
}

function pack(input: {
  observedAt: number
  agent: string
  participants: Participant[]
  participantsTruncated: boolean
  messages: Message[]
  limit: number
  since?: string
  recovered?: boolean
}): Effect.Effect<ReadResult, Failure> {
  const chosen: Participant[] = []
  const base = (messages: Message[], more: boolean, truncated: boolean): ReadResult => {
    const cursor = messages.at(-1)?.id ?? input.since
    return {
      observedAt: input.observedAt,
      agent: input.agent,
      participants: chosen,
      messages,
      hasMore: more,
      ...(cursor ? { cursor } : {}),
      ...(truncated ? { participantsTruncated: true } : {}),
      ...(input.recovered ? { recovered: true } : {}),
    }
  }
  const size = (value: ReadResult) => Buffer.byteLength(JSON.stringify(value))
  const reserve = Math.max(READ_RESERVE, Buffer.byteLength(JSON.stringify(input.messages.at(0) ?? {})) + 2048)
  for (const participant of input.participants) {
    chosen.push(participant)
    if (size(base([], input.messages.length > 0, true)) + reserve > MAX_READ) {
      chosen.pop()
      break
    }
  }
  const truncated = input.participantsTruncated || chosen.length < input.participants.length
  const page: Message[] = []
  for (const item of input.messages) {
    if (page.length >= input.limit) break
    const next = [...page, item]
    if (size(base(next, input.messages.length > next.length, truncated)) > MAX_READ) {
      if (page.length === 0) return fail("Board read result exceeds 32 KiB")
      break
    }
    page.push(item)
  }
  if (!page.length && input.messages.length) return fail("Board read result exceeds 32 KiB")
  const result = base(page, input.messages.length > page.length, truncated)
  if (size(result) > MAX_READ) return fail("Board read result exceeds 32 KiB")
  return Effect.succeed(result)
}

function validatePost(input: {
  messageID: string
  callID?: string
  to: string
  type: Kind
  body: string
  reply_to?: string
}): string | undefined {
  if (!input.messageID) return "Board message identity is required"
  if (input.callID !== undefined && !input.callID) return "Board tool call identity is invalid"
  if (!input.to) return "Board recipient is required"
  if (!Schema.is(Kind)(input.type)) return "Board message type is invalid"
  if (!input.body.trim()) return "Board message body is required"
  if (input.reply_to !== undefined && !input.reply_to) return "Board reply identity is invalid"
  return undefined
}

function checkLimit(value: number | undefined): Effect.Effect<number, Failure> {
  if (value === undefined) return Effect.succeed(DEFAULT_LIMIT)
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT)
    return fail(`Board read limit must be between 1 and ${MAX_LIMIT}`)
  return Effect.succeed(value)
}

function fail(message: string, kind?: Failure["kind"]): Effect.Effect<never, Failure> {
  return Effect.fail(new Failure({ message, ...(kind ? { kind } : {}) }))
}
