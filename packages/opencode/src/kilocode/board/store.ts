import { sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { randomUUID } from "node:crypto"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionID } from "@/session/schema"

type DB = Database.Interface["db"]
type TX = Parameters<Parameters<DB["transaction"]>[0]>[0]
type Row = {
  id: string
  project_id: string
  parent_id: string | null
  directory: string
  agent: string | null
  title: string
  time_created: number
}
type MessageRow = {
  id: string
  board_root_session_id: string
  seq: number
  time_created: number
  sender_session_id: string
  recipient: string
  type: string
  body: string
  reply_to: string | null
  source_message_id: string
  source_call_id: string
}
type BoardRow = {
  root_session_id: string
  objective: string
  objective_message_id: string | null
  next_seq: number
  cleared_seq: number
  message_count: number
  message_bytes: number
}

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
const WHITESPACE =
  "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

export namespace BoardStore {
  export const Kind = Schema.Literals(["INFO", "ASK", "RESULT", "HOLD", "VETO"])
  export type Kind = typeof Kind.Type

  const Integer = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

  export const Message = Schema.Struct({
    id: Schema.String,
    timestamp: Integer,
    from: Schema.String,
    to: Schema.String,
    fromLabel: Schema.optional(Schema.String),
    toLabel: Schema.optional(Schema.String),
    type: Kind,
    body: Schema.String,
    reply_to: Schema.optional(Schema.String),
  }).annotate({ identifier: "BoardMessage" })
  export type Message = typeof Message.Type

  export type Execution = {
    state: "running" | "busy" | "retry" | "offline" | "completed" | "error" | "cancelled" | "unknown"
    updated?: number
  }

  export type Participant = {
    id: string
    sessionID: string
    label: string
    agent?: string
    state: Execution["state"]
  }

  export const SessionBoard = Schema.Struct({
    ownerSessionID: SessionID,
    revision: Integer,
    messages: Schema.Array(Message),
    cursor: Schema.optional(Schema.String),
    hasMore: Schema.Boolean,
  }).annotate({ identifier: "SessionBoard" })

  export type Snapshot = {
    observedAt: number
    sessions: ReadonlyMap<string, Execution>
  }

  export type Scope = {
    root: SessionID
    agent: "main" | SessionID
    parent?: SessionID
    objective: string
  }

  export class Error extends Schema.TaggedErrorClass<Error>()("BoardStore.Error", {
    message: Schema.String,
    kind: Schema.optional(Schema.Literal("storage")),
  }) {}

  export class Conflict extends Schema.TaggedErrorClass<Conflict>()("BoardStore.Conflict", {
    message: Schema.String,
  }) {}

  type View = {
    sessionID: SessionID
    directory: string
    before?: string
    limit?: number
  }

  export const observe = Effect.fn("BoardStore.observe")(function* (input: View) {
    const { db } = yield* Database.Service
    return yield* db.transaction((tx) => view(tx, input)).pipe(Effect.mapError(mapError))
  })

  export const reset = Effect.fn("BoardStore.reset")(function* (
    input: Omit<View, "before" | "limit"> & { revision: number },
  ) {
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) return yield* fail("Board revision is invalid")
    const { db } = yield* Database.Service
    return yield* db
      .transaction(
        (tx) =>
          Effect.gen(function* () {
            const line = yield* walk(tx, input.sessionID)
            if (line.root !== input.sessionID) return yield* fail("Only the owning session can reset this board")
            if (
              !line.current.directory ||
              !input.directory ||
              FSUtil.resolve(line.current.directory) !== FSUtil.resolve(input.directory)
            )
              return yield* fail("Session is not in the routed directory")
            const board = yield* get(tx, line.root)
            if (input.revision !== (board ? board.next_seq - 1 : 0))
              return yield* new Conflict({ message: "The board changed. Refresh it before clearing messages." })
            if (board) {
              yield* tx.run(sql`
                UPDATE kilo_board
                SET cleared_seq = ${input.revision}, message_count = 0, message_bytes = 0, time_updated = ${Date.now()}
                WHERE root_session_id = ${line.root}
              `)
            }
            return yield* view(tx, input)
          }),
        { behavior: "immediate" },
      )
      .pipe(Effect.mapError(mapError))
  })

  export const scope = Effect.fn("BoardStore.scope")(function* (sessionID: SessionID) {
    const { db } = yield* Database.Service
    const line = yield* walk(db, sessionID)
    const stored = yield* get(db, line.root)
    if (stored?.objective_message_id) return result(line, stored.objective)
    return yield* db
      .transaction((tx) => ensure(tx, sessionID), { behavior: "immediate" })
      .pipe(Effect.mapError((error) => mapError(error)))
  })

  export const read = Effect.fn("BoardStore.read")(function* (input: {
    sessionID: SessionID
    since?: string
    limit?: number
    snapshot?: Snapshot
  }) {
    const { db } = yield* Database.Service
    const limit = yield* checkLimit(input.limit)
    const current = yield* scope(input.sessionID)
    return yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          const board = yield* get(tx, current.root)
          if (!board) return yield* fail("Board was not initialized")
          const since = yield* cursor(tx, current.root, input.since)
          const rows = yield* tx.all<MessageRow>(sql`
            SELECT id, board_root_session_id, seq, time_created, sender_session_id, recipient, type, body, reply_to,
              source_message_id, source_call_id
            FROM kilo_board_message
            WHERE board_root_session_id = ${current.root}
              AND seq > ${Math.max(since ?? 0, board.cleared_seq)} AND seq < ${board.next_seq}
            ORDER BY seq ASC
            LIMIT ${limit + 1}
          `)
          const labels = yield* titles(
            tx,
            current.root,
            rows.flatMap((row) => [row.sender_session_id, row.recipient]),
          )
          const messages = rows.map((row) => enrich(message(row, current.root), labels))
          const snapshot = input.snapshot ?? { observedAt: Date.now(), sessions: new Map<string, Execution>() }
          const members = yield* participants(tx, current.root, input.sessionID, snapshot)
          return yield* pack({
            observedAt: snapshot.observedAt,
            agent: current.agent,
            participants: members.rows,
            participantsTruncated: members.truncated,
            messages,
            limit,
            since: input.since,
          })
        }),
      )
      .pipe(Effect.mapError(mapError))
  })

  export const post = Effect.fn("BoardStore.post")(function* (input: {
    sessionID: SessionID
    messageID: string
    callID?: string
    to: string
    type: Kind
    body: string
    reply_to?: string
  }) {
    const invalid = validatePost(input)
    if (invalid) return yield* fail(invalid)
    const { db } = yield* Database.Service
    return yield* db
      .transaction(
        (tx) =>
          Effect.gen(function* () {
            const current = yield* ensure(tx, input.sessionID)
            const target = yield* recipient(input.to, current.root, tx)
            if (target !== ALL && target === input.sessionID)
              return yield* fail("Board messages cannot be sent to yourself")
            const ids = target === ALL ? [input.sessionID] : [input.sessionID, target]
            const labels = yield* titles(tx, current.root, ids, true)
            const call = input.callID ?? ""
            const existing = yield* tx.get<MessageRow>(sql`
                SELECT id, board_root_session_id, seq, time_created, sender_session_id, recipient, type, body, reply_to,
                  source_message_id, source_call_id
                FROM kilo_board_message
                WHERE board_root_session_id = ${current.root}
                  AND sender_session_id = ${input.sessionID}
                  AND source_message_id = ${input.messageID}
                  AND source_call_id = ${call}
              `)
            if (existing) {
              if (
                existing.recipient !== target ||
                existing.type !== input.type ||
                existing.body !== input.body ||
                (existing.reply_to ?? undefined) !== input.reply_to
              )
                return yield* fail("The trusted board tool call was retried with different arguments")
              return enrich(message(existing, current.root), labels)
            }

            const reply = input.reply_to
              ? yield* tx
                  .get<{ id: string }>(
                    sql`
                    SELECT id
                    FROM kilo_board_message
                    WHERE board_root_session_id = ${current.root} AND id = ${input.reply_to}
                  `,
                  )
                  .pipe(Effect.mapError((error) => mapError(error)))
              : undefined
            if (input.reply_to && !reply) return yield* fail("Reply message is not on this board")

            const id = `board_${randomUUID()}`
            const timestamp = Date.now()
            const value: Message = {
              id,
              timestamp,
              from: input.sessionID === current.root ? "main" : input.sessionID,
              to: target === ALL ? ALL : target === current.root ? "main" : target,
              type: input.type,
              body: input.body,
              ...(input.reply_to ? { reply_to: input.reply_to } : {}),
            }
            const bytes = Buffer.byteLength(format(value))
            if (bytes > MAX_MESSAGE) return yield* fail(`Formatted board message exceeds ${MAX_MESSAGE} bytes`)

            const board = yield* tx
              .get<BoardRow>(
                sql`
                SELECT root_session_id, objective, objective_message_id, next_seq, message_count, message_bytes
                FROM kilo_board
                WHERE root_session_id = ${current.root}
              `,
              )
              .pipe(Effect.mapError((error) => mapError(error)))
            if (!board) return yield* fail("Board was not initialized")
            if (board.message_count >= MAX_MESSAGES) return yield* fail("Board message limit reached")
            if (board.message_bytes + bytes > MAX_BYTES) return yield* fail("Board storage limit reached")

            yield* tx.run(sql`
              INSERT INTO kilo_board_message (
                id, board_root_session_id, seq, time_created, sender_session_id, recipient, type, body, reply_to,
                source_message_id, source_call_id
              ) VALUES (
                ${id}, ${current.root}, ${board.next_seq}, ${timestamp}, ${input.sessionID}, ${target}, ${input.type},
                ${input.body}, ${input.reply_to ?? null}, ${input.messageID}, ${call}
              )
            `)
            yield* tx.run(sql`
              UPDATE kilo_board
              SET next_seq = ${board.next_seq + 1}, message_count = ${board.message_count + 1},
                message_bytes = ${board.message_bytes + bytes}, time_updated = ${timestamp}
              WHERE root_session_id = ${current.root}
            `)
            return enrich(value, labels)
          }),
        { behavior: "immediate" },
      )
      .pipe(Effect.mapError((error) => mapError(error)))
  })

  export const activity = Effect.fn("BoardStore.activity")(function* (input: {
    sessionID: SessionID
    after: number
    read?: string
  }) {
    if (!Number.isSafeInteger(input.after) || input.after < 0)
      return yield* fail("Board activity sequence must be a non-negative integer")
    const { db } = yield* Database.Service
    const current = yield* scope(input.sessionID)
    const latest = yield* db
      .get<{ cursor: number; message: number | null }>(
        sql`
        SELECT board.next_seq - 1 AS cursor, (
          SELECT MAX(seq)
          FROM kilo_board_message
          WHERE board_root_session_id = board.root_session_id
            AND seq > ${input.after} AND seq > board.cleared_seq AND seq < board.next_seq
            ${
              input.read === undefined
                ? sql``
                : sql`AND seq > COALESCE((
                    SELECT seq FROM kilo_board_message
                    WHERE board_root_session_id = board.root_session_id AND id = ${input.read}
                  ), 0)`
            }
            AND sender_session_id <> ${input.sessionID}
            AND (recipient = ${input.sessionID} OR recipient = ${ALL})
        ) AS message
        FROM kilo_board board
        WHERE board.root_session_id = ${current.root}
      `,
      )
      .pipe(Effect.mapError((error) => mapError(error)))
    if (!latest) return yield* fail("Board was not initialized")
    return { cursor: Math.max(input.after, latest.cursor), message: latest.message ?? 0 }
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
    const out: string[] = []
    let size = 0
    const max = bytes - Buffer.byteLength(TRUNCATED)
    for (const char of text) {
      const next = Buffer.byteLength(char)
      if (size + next > max) break
      out.push(char)
      size += next
    }
    return out.join("") + TRUNCATED
  }

  function take(text: string, bytes: number) {
    const out: string[] = []
    let size = 0
    for (const char of text) {
      const next = Buffer.byteLength(char)
      if (size + next > bytes) break
      out.push(char)
      size += next
    }
    return out.join("")
  }

  function validatePost(input: {
    messageID: string
    callID?: string
    to: string
    type: Kind
    body: string
    reply_to?: string
  }): string | undefined {
    if (!input.messageID || typeof input.messageID !== "string") return "Board message identity is required"
    if (input.callID !== undefined && (!input.callID || typeof input.callID !== "string"))
      return "Board tool call identity is invalid"
    if (typeof input.to !== "string" || !input.to) return "Board recipient is required"
    if (!Schema.is(Kind)(input.type)) return "Board message type is invalid"
    if (typeof input.body !== "string" || !input.body.trim()) return "Board message body is required"
    if (input.reply_to !== undefined && (typeof input.reply_to !== "string" || !input.reply_to))
      return "Board reply identity is invalid"
    return undefined
  }

  function checkLimit(value: number | undefined): Effect.Effect<number, Error> {
    if (value === undefined) return Effect.succeed(DEFAULT_LIMIT)
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT)
      return fail(`Board read limit must be between 1 and ${MAX_LIMIT}`)
    return Effect.succeed(value)
  }

  function row(tx: DB | TX, id: string) {
    return tx
      .get<Row>(
        sql`
        SELECT id, project_id, parent_id, directory, agent, title, time_created
        FROM session
        WHERE id = ${id}
      `,
      )
      .pipe(Effect.mapError((error) => mapError(error)))
  }

  function walk(tx: DB | TX, id: string) {
    return Effect.gen(function* () {
      const current = yield* row(tx, id)
      if (!current) return yield* fail(`Session not found: ${id}`)
      const seen = new Set<string>()
      let next = current
      while (true) {
        if (seen.has(next.id)) return yield* fail(`Session lineage is cyclic: ${id}`)
        seen.add(next.id)
        if (!next.parent_id) return { root: next.id, current }
        const parent = yield* row(tx, next.parent_id)
        if (!parent) return yield* fail(`Session lineage parent is missing: ${next.parent_id}`)
        if (parent.project_id !== next.project_id || parent.directory !== next.directory)
          return yield* fail(`Session lineage crosses a project or worktree boundary: ${id}`)
        next = parent
      }
    })
  }

  function cursor(tx: DB | TX, root: string, id: string | undefined) {
    return Effect.gen(function* () {
      if (id === undefined) return undefined
      const row = yield* tx.get<{ seq: number }>(sql`
        SELECT seq FROM kilo_board_message WHERE board_root_session_id = ${root} AND id = ${id}
      `)
      if (!row) return yield* fail(`Board cursor is not valid for session ${root}`)
      return row.seq
    })
  }

  function view(tx: TX, input: View) {
    return Effect.gen(function* () {
      const limit = yield* checkLimit(input.limit)
      const line = yield* walk(tx, input.sessionID)
      if (
        !line.current.directory ||
        !input.directory ||
        FSUtil.resolve(line.current.directory) !== FSUtil.resolve(input.directory)
      )
        return yield* fail("Session is not in the routed directory")
      const root = SessionID.make(line.root)
      const board = yield* get(tx, root)
      const before = yield* cursor(tx, root, input.before)
      const rows = yield* tx.all<MessageRow>(sql`
        SELECT id, board_root_session_id, seq, time_created, sender_session_id, recipient, type, body, reply_to,
          source_message_id, source_call_id
        FROM kilo_board_message
        WHERE board_root_session_id = ${root} AND seq > ${board?.cleared_seq ?? 0}
          AND seq < ${Math.min(before ?? Infinity, board?.next_seq ?? 1)}
        ORDER BY seq DESC
        LIMIT ${limit + 1}
      `)
      const labels = yield* titles(
        tx,
        root,
        rows.flatMap((row) => [row.sender_session_id, row.recipient]),
      )
      const page = yield* pack({
        observedAt: Date.now(),
        agent: root,
        participants: [],
        participantsTruncated: false,
        messages: rows.map((row) => enrich(message(row, root), labels)),
        limit,
      })
      return {
        ownerSessionID: root,
        revision: board ? board.next_seq - 1 : 0,
        messages: page.messages.toReversed(),
        hasMore: page.hasMore,
        ...(page.hasMore && page.cursor ? { cursor: page.cursor } : {}),
      }
    })
  }

  function get(tx: DB | TX, root: string) {
    return tx
      .get<BoardRow>(
        sql`
        SELECT root_session_id, objective, objective_message_id, next_seq, cleared_seq, message_count, message_bytes
        FROM kilo_board
        WHERE root_session_id = ${root}
      `,
      )
      .pipe(Effect.mapError((error) => mapError(error)))
  }

  function result(line: { root: string; current: Row }, objective: string): Scope {
    return {
      root: SessionID.make(line.root),
      agent: line.current.id === line.root ? "main" : SessionID.make(line.current.id),
      ...(line.current.parent_id ? { parent: SessionID.make(line.current.parent_id) } : {}),
      objective,
    }
  }

  function recipient(value: string, root: string, tx: TX) {
    if (value === ALL) return Effect.succeed(ALL)
    const id = value === "main" ? root : value
    return Effect.gen(function* () {
      const line = yield* walk(tx, id)
      if (line.root !== root) return yield* fail(`Board recipient is not a participant in this board: ${value}`)
      return id
    })
  }

  function objective(tx: TX, root: string) {
    return Effect.gen(function* () {
      const current = yield* tx.get<{ id: string; text: string }>(sql`
        SELECT id, json_extract(data, '$.text') AS text
        FROM session_message INDEXED BY session_message_session_type_seq_idx
        WHERE session_id = ${root} AND type = 'user' AND seq IS NOT NULL
          AND json_valid(data)
          AND typeof(json_extract(data, '$.text')) = 'text'
          AND trim(json_extract(data, '$.text'), ${WHITESPACE}) <> ''
          AND coalesce(json_extract(data, '$.synthetic'), 0) = 0
        ORDER BY seq ASC
        LIMIT 1
      `)
      if (current) return current
      return yield* tx.get<{ id: string; text: string }>(sql`
        SELECT id, text
        FROM (
          SELECT * FROM (
            SELECT m.id, json_extract(p.data, '$.text') AS text, m.time_created, m.id AS order_id, p.id AS part_id
            FROM message m INDEXED BY message_session_time_created_id_idx
            JOIN part p ON p.id = (
              SELECT id
              FROM part INDEXED BY part_message_id_id_idx
              WHERE message_id = m.id
                AND json_valid(data)
                AND json_extract(data, '$.type') = 'text'
                AND typeof(json_extract(data, '$.text')) = 'text'
                AND trim(json_extract(data, '$.text'), ${WHITESPACE}) <> ''
                AND coalesce(json_extract(data, '$.synthetic'), 0) = 0
                AND coalesce(json_extract(data, '$.ignored'), 0) = 0
              ORDER BY id ASC
              LIMIT 1
            )
            WHERE m.session_id = ${root}
              AND json_valid(m.data)
              AND json_extract(m.data, '$.role') = 'user'
            ORDER BY m.time_created ASC, m.id ASC
            LIMIT 1
          )
          UNION ALL
          SELECT * FROM (
            SELECT id, json_extract(data, '$.text') AS text, time_created, id AS order_id, id AS part_id
            FROM session_message INDEXED BY session_message_session_time_created_id_idx
            WHERE session_id = ${root} AND type = 'user' AND seq IS NULL
              AND json_valid(data)
              AND typeof(json_extract(data, '$.text')) = 'text'
              AND trim(json_extract(data, '$.text'), ${WHITESPACE}) <> ''
              AND coalesce(json_extract(data, '$.synthetic'), 0) = 0
            ORDER BY time_created ASC, id ASC
            LIMIT 1
          )
        )
        ORDER BY time_created ASC, order_id ASC, part_id ASC
        LIMIT 1
      `)
    }).pipe(Effect.mapError((error) => mapError(error)))
  }

  function ensure(tx: TX, sessionID: SessionID) {
    return Effect.gen(function* () {
      const line = yield* walk(tx, sessionID)
      const existing = yield* get(tx, line.root)
      const first = existing?.objective_message_id ? undefined : yield* objective(tx, line.root)
      const now = Date.now()
      if (!existing) {
        yield* tx.run(sql`
          INSERT INTO kilo_board (
            root_session_id, objective, objective_message_id, next_seq, message_count, message_bytes, time_created,
            time_updated
          ) VALUES (${line.root}, ${excerpt(first?.text ?? "")}, ${first?.id ?? null}, 1, 0, 0, ${now}, ${now})
        `)
      }
      if (existing && !existing.objective_message_id && first) {
        yield* tx.run(sql`
          UPDATE kilo_board
          SET objective = ${excerpt(first.text)}, objective_message_id = ${first.id}, time_updated = ${now}
          WHERE root_session_id = ${line.root}
        `)
      }
      return result(line, existing?.objective_message_id ? existing.objective : excerpt(first?.text ?? ""))
    })
  }

  function lineage(root: string) {
    return sql`WITH RECURSIVE members(id, project_id, directory) AS (
      SELECT id, project_id, directory FROM session WHERE id = ${root}
      UNION
      SELECT child.id, child.project_id, child.directory
      FROM session child JOIN members parent ON child.parent_id = parent.id
      WHERE child.project_id = parent.project_id AND child.directory = parent.directory
    )`
  }

  function available(state: Execution["state"]) {
    return state === "running" || state === "busy" || state === "retry" || state === "offline"
  }

  export const availability = Effect.fn("BoardStore.availability")(function* (input: {
    sessionID: SessionID
    to: string
    snapshot: Snapshot
  }) {
    const { db } = yield* Database.Service
    const current = yield* scope(input.sessionID)
    const known = [...input.snapshot.sessions].filter(([, value]) => value.state !== "unknown")
    const running = JSON.stringify(known.filter(([, value]) => available(value.state)).map(([id]) => id))
    const stopped = JSON.stringify(known.filter(([, value]) => !available(value.state)).map(([id]) => id))
    const target = input.to === "main" ? current.root : input.to
    const counts = yield* db
      .get<{ total: number; active: number; inactive: number }>(
        sql`
      ${lineage(current.root)}
      SELECT COUNT(*) AS total,
        COALESCE(SUM(id IN (SELECT value FROM json_each(${running}))), 0) AS active,
        COALESCE(SUM(id IN (SELECT value FROM json_each(${stopped}))), 0) AS inactive
      FROM members
      WHERE id <> ${input.sessionID} ${target === ALL ? sql`` : sql`AND id = ${target}`}
    `,
      )
      .pipe(Effect.mapError((error) => mapError(error)))
    const total = counts?.total ?? 0
    const active = counts?.active ?? 0
    const inactive = counts?.inactive ?? 0
    return { observedAt: input.snapshot.observedAt, total, active, inactive, unknown: total - active - inactive }
  })

  function titles(tx: DB | TX, root: string, ids: string[], verified = false) {
    if (!ids.length) return Effect.succeed(new Map<string, string>())
    return tx
      .all<Pick<Row, "id" | "title">>(
        sql`
        ${verified ? sql`` : lineage(root)}
        SELECT session.id, session.title
        FROM session ${verified ? sql`` : sql`JOIN members ON members.id = session.id`}
        WHERE session.id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))
      `,
      )
      .pipe(
        Effect.map(
          (rows) => new Map(rows.map((row) => [row.id === root ? "main" : row.id, excerpt(row.title, MAX_LABEL)])),
        ),
        Effect.mapError((error) => mapError(error)),
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

  function participants(db: DB | TX, root: string, self: string, snapshot: Snapshot) {
    return Effect.gen(function* () {
      const running = JSON.stringify(
        Object.fromEntries(
          [...snapshot.sessions]
            .filter(([, value]) => available(value.state))
            .map(([id, value]) => [id, value.updated ?? 0]),
        ),
      )
      const rows = yield* db.all<Pick<Row, "id" | "agent" | "title">>(sql`
        ${lineage(root)},
        active AS MATERIALIZED (
          SELECT key AS id, value AS updated FROM json_each(${running})
        )
        SELECT session.id, session.agent, session.title
        FROM session JOIN members ON members.id = session.id
        LEFT JOIN active ON active.id = session.id
        ORDER BY CASE WHEN session.id = ${root} THEN 0 WHEN session.id = ${self} THEN 1 ELSE 2 END,
          COALESCE(active.updated, -1) DESC,
          session.time_created DESC, session.id DESC
        LIMIT ${MAX_ROSTER + 1}
      `)
      return {
        rows: rows.slice(0, MAX_ROSTER).map(
          (row): Participant => ({
            id: row.id === root ? "main" : row.id,
            sessionID: row.id,
            label: excerpt(row.title, MAX_LABEL),
            ...(row.agent ? { agent: excerpt(row.agent, 128) } : {}),
            state: snapshot.sessions.get(row.id)?.state ?? "unknown",
          }),
        ),
        truncated: rows.length > MAX_ROSTER,
      }
    }).pipe(Effect.mapError((error) => mapError(error)))
  }
  function message(row: MessageRow, root: string): Message {
    if (!Schema.is(Kind)(row.type)) throw new globalThis.Error(`Invalid board message type in ${root}`)
    return {
      id: row.id,
      timestamp: row.time_created,
      from: row.sender_session_id === root ? "main" : row.sender_session_id,
      to: row.recipient === ALL ? ALL : row.recipient === root ? "main" : row.recipient,
      type: row.type,
      body: row.body,
      ...(row.reply_to ? { reply_to: row.reply_to } : {}),
    }
  }

  function pack(input: {
    observedAt: number
    agent: "main" | SessionID
    participants: Participant[]
    participantsTruncated: boolean
    messages: Message[]
    limit: number
    since?: string
  }): Effect.Effect<
    {
      observedAt: number
      agent: string
      participants: Participant[]
      messages: Message[]
      cursor?: string
      hasMore: boolean
      participantsTruncated?: boolean
    },
    Error
  > {
    const all = input.participants
    const chosen: Participant[] = []
    const base = (messages: Message[], more: boolean, truncated: boolean) => {
      const cursor = messages.at(-1)?.id ?? input.since
      return {
        observedAt: input.observedAt,
        agent: input.agent,
        participants: chosen,
        messages,
        hasMore: more,
        ...(cursor ? { cursor } : {}),
        ...(truncated ? { participantsTruncated: true } : {}),
      }
    }
    const size = (value: ReturnType<typeof base>) => Buffer.byteLength(JSON.stringify(value))
    const reserve = Math.max(READ_RESERVE, Buffer.byteLength(JSON.stringify(input.messages.at(0) ?? {})) + 2048)
    for (const participant of all) {
      chosen.push(participant)
      if (size(base([], input.messages.length > 0, true)) + reserve > MAX_READ) {
        chosen.pop()
        break
      }
    }
    const truncated = input.participantsTruncated || chosen.length < all.length
    const page: Message[] = []
    for (const item of input.messages) {
      if (page.length >= input.limit) break
      const next = [...page, item]
      const more = input.messages.length > next.length
      if (size(base(next, more, truncated)) > MAX_READ) {
        if (page.length === 0) return fail("Board read result exceeds 32 KiB")
        break
      }
      page.push(item)
    }
    const more = input.messages.length > page.length
    if (!page.length && input.messages.length) return fail("Board read result exceeds 32 KiB")
    const result = base(page, more, truncated)
    if (size(result) > MAX_READ) return fail("Board read result exceeds 32 KiB")
    return Effect.succeed(result)
  }

  function fail(message: string): Effect.Effect<never, Error> {
    return Effect.fail(new Error({ message }))
  }

  function mapError(error: unknown) {
    return error instanceof Error || error instanceof Conflict
      ? error
      : new Error({ message: "Board storage operation failed", kind: "storage" })
  }
}
