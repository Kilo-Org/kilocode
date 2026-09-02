import { sql } from "drizzle-orm"
import { Effect, Result, Schema } from "effect"
import { randomUUID } from "node:crypto"
import { Database } from "@opencode-ai/core/database/database"
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
const MAX_LABEL = 128
const ALL = "ALL"
const TRUNCATED = "[truncated]"
const WHITESPACE =
  "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

export namespace BoardStore {
  export const Kind = Schema.Literals(["INFO", "ASK", "RESULT", "HOLD", "VETO"])
  export type Kind = typeof Kind.Type
  export type State = "busy" | "retry" | "offline" | "running" | "completed" | "error" | "cancelled" | "unknown"
  export type Participant = {
    id: string
    sessionID: string
    label: string
    agent?: string
    description: string
    state: State
  }

  export function active(state: State) {
    return state === "busy" || state === "retry" || state === "offline" || state === "running"
  }

  export type Message = {
    id: string
    timestamp: number
    from: string
    to: string
    type: Kind
    body: string
    reply_to?: string
  }

  export type Scope = {
    root: SessionID
    agent: "main" | SessionID
    parent?: SessionID
    objective: string
  }

  export class Error extends Schema.TaggedErrorClass<Error>()("BoardStore.Error", {
    message: Schema.String,
  }) {}

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
    states?: Record<string, State>
  }) {
    const { db } = yield* Database.Service
    const limit = yield* checkLimit(input.limit)
    const current = yield* scope(input.sessionID)
    const board = yield* db
      .get<BoardRow>(
        sql`
        SELECT root_session_id, objective, objective_message_id, next_seq, message_count, message_bytes
        FROM kilo_board
        WHERE root_session_id = ${current.root}
      `,
      )
      .pipe(Effect.mapError((error) => mapError(error)))
    if (!board) return yield* fail("Board was not initialized")

    const anchor =
      input.since !== undefined
        ? yield* db
            .get<{ seq: number }>(
              sql`
            SELECT seq
            FROM kilo_board_message
            WHERE board_root_session_id = ${current.root} AND id = ${input.since}
          `,
            )
            .pipe(Effect.mapError((error) => mapError(error)))
        : undefined
    if (input.since !== undefined && !anchor)
      return yield* fail(`Board cursor is not valid for session ${current.root}`)

    const rows = yield* db
      .all<MessageRow>(
        sql`
        SELECT id, board_root_session_id, seq, time_created, sender_session_id, recipient, type, body, reply_to,
          source_message_id, source_call_id
        FROM kilo_board_message
        WHERE board_root_session_id = ${current.root} ${anchor ? sql`AND seq > ${anchor.seq}` : sql``}
        ORDER BY seq ASC
        LIMIT ${limit + 1}
      `,
      )
      .pipe(Effect.mapError((error) => mapError(error)))
    const messages = rows.map((row) => message(row, current.root))
    const members = yield* participants({ sessionID: input.sessionID, states: input.states })
    return yield* pack({
      agent: current.agent,
      participants: members.rows,
      participantsTruncated: members.truncated,
      messages,
      limit,
      since: input.since,
    })
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
              return message(existing, current.root)
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
            return { ...value }
          }),
        { behavior: "immediate" },
      )
      .pipe(Effect.mapError((error) => mapError(error)))
  })

  export const activity = Effect.fn("BoardStore.activity")(function* (input: {
    sessionID: SessionID
    after: number
    read?: { since?: string; cursor: string }
  }) {
    if (!Number.isSafeInteger(input.after) || input.after < 0)
      return yield* fail("Board activity sequence must be a non-negative integer")
    const { db } = yield* Database.Service
    const current = yield* scope(input.sessionID)
    const read = input.read
      ? yield* db
          .get<{ start: number | null; finish: number }>(
            sql`
            SELECT seq AS finish, ${
              input.read.since
                ? sql`(SELECT seq FROM kilo_board_message
                    WHERE board_root_session_id = ${current.root} AND id = ${input.read.since})`
                : sql`0`
            } AS start
            FROM kilo_board_message
            WHERE board_root_session_id = ${current.root} AND id = ${input.read.cursor}
          `,
          )
          .pipe(Effect.mapError((error) => mapError(error)))
      : undefined
    const latest = yield* db
      .get<{ cursor: number; message: number | null }>(
        sql`
        SELECT board.next_seq - 1 AS cursor, (
          SELECT MAX(seq)
          FROM kilo_board_message
          WHERE board_root_session_id = board.root_session_id
            AND seq > ${input.after} AND seq < board.next_seq
            ${read?.start != null ? sql`AND (seq <= ${read.start} OR seq > ${read.finish})` : sql``}
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

  function walk(tx: DB | TX, id: string, limit = Infinity) {
    return Effect.gen(function* () {
      const current = yield* row(tx, id)
      if (!current) return yield* fail(`Session not found: ${id}`)
      const seen = new Set<string>()
      let next = current
      while (true) {
        if (seen.has(next.id)) return yield* fail(`Session lineage is cyclic: ${id}`)
        seen.add(next.id)
        if (!next.parent_id) return { root: next.id, current }
        if (seen.size >= limit) return yield* fail("Session lineage exceeds the participant discovery limit")
        const parent = yield* row(tx, next.parent_id)
        if (!parent) return yield* fail(`Session lineage parent is missing: ${next.parent_id}`)
        if (parent.project_id !== next.project_id || parent.directory !== next.directory)
          return yield* fail(`Session lineage crosses a project or worktree boundary: ${id}`)
        next = parent
      }
    })
  }

  function get(tx: DB | TX, root: string) {
    return tx
      .get<BoardRow>(
        sql`
        SELECT root_session_id, objective, objective_message_id, next_seq, message_count, message_bytes
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

  export const participants = Effect.fn("BoardStore.participants")(function* (input: {
    sessionID: SessionID
    states?: Record<string, State>
  }) {
    const { db } = yield* Database.Service
    const current = yield* walk(db, input.sessionID)
    const root = current.root
    const states = input.states ?? {}
    return yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          const first = yield* row(tx, root)
          if (!first) return yield* fail(`Session not found: ${root}`)
          const rows = [first]
          if (input.sessionID !== root) rows.push(current.current)
          const seen = new Set(rows.map((row) => row.id))
          const live = Object.keys(states).filter((id) => active(states[id] ?? "unknown"))
          const priority = live.length
            ? yield* tx.all<{ id: string }>(sql`
                SELECT id FROM session
                WHERE parent_id IS NOT NULL
                  AND project_id = ${first.project_id} AND directory = ${first.directory}
                  AND id IN (SELECT value FROM json_each(${JSON.stringify(live)}))
                ORDER BY CASE WHEN parent_id = ${root} THEN 0 ELSE 1 END, time_updated DESC, id DESC
                LIMIT ${MAX_ROSTER}
              `)
            : []
          let incomplete = false
          for (const { id } of priority) {
            if (seen.has(id)) continue
            const member = yield* walk(tx, id, MAX_ROSTER).pipe(Effect.result)
            if (Result.isFailure(member) || member.success.root !== root) continue
            if (rows.length >= MAX_ROSTER) {
              incomplete = true
              break
            }
            seen.add(id)
            rows.push(member.success.current)
          }
          let budget = MAX_ROSTER
          for (const parent of rows) {
            if (!budget) break
            const children = yield* tx.all<Row>(sql`
              SELECT id, project_id, parent_id, directory, agent, title, time_created
              FROM session INDEXED BY session_parent_idx
              WHERE parent_id = ${parent.id}
              ORDER BY rowid DESC
              LIMIT ${budget}
            `)
            budget -= children.length
            for (const child of children) {
              if (child.project_id !== parent.project_id || child.directory !== parent.directory || seen.has(child.id))
                continue
              seen.add(child.id)
              rows.push(child)
            }
          }
          return {
            rows: rows.slice(0, MAX_ROSTER).map(
              (row): Participant => ({
                id: row.id === root ? "main" : row.id,
                sessionID: row.id,
                label: excerpt(row.id === root ? "main" : row.title || row.agent || row.id, MAX_LABEL),
                ...(row.agent ? { agent: excerpt(row.agent, MAX_LABEL) } : {}),
                description: excerpt(row.title.replace(/ \(@.* subagent\)$/, ""), MAX_LABEL),
                state: states[row.id] ?? "unknown",
              }),
            ),
            truncated: incomplete || budget === 0 || rows.length > MAX_ROSTER,
          }
        }),
      )
      .pipe(Effect.mapError((error) => mapError(error)))
  })
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
    agent: "main" | SessionID
    participants: Participant[]
    participantsTruncated: boolean
    messages: Message[]
    limit: number
    since?: string
  }): Effect.Effect<
    {
      agent: string
      observedAt: number
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
    const timestamp = Date.now()
    const base = (messages: Message[], more: boolean, truncated: boolean) => {
      const cursor = messages.at(-1)?.id ?? input.since
      return {
        agent: input.agent,
        observedAt: timestamp,
        participants: chosen,
        messages,
        hasMore: more,
        ...(cursor ? { cursor } : {}),
        ...(truncated ? { participantsTruncated: true } : {}),
      }
    }
    const size = (value: ReturnType<typeof base>) => Buffer.byteLength(JSON.stringify(value))
    for (const participant of all) {
      chosen.push(participant)
      if (size(base([], input.messages.length > 0, true)) + READ_RESERVE > MAX_READ) {
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
    return error instanceof Error ? error : new Error({ message: "Board storage operation failed" })
  }
}
