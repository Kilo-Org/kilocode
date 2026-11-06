// kilocode_change - new file
import { test, expect } from "bun:test"
import { Cause, Effect, Option } from "effect"
import { eq } from "drizzle-orm"
import path from "path"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { decodeImportMessages, formatImportWriteError, importDocument, writeImport } from "../../src/cli/cmd/import"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { tmpdir } from "../fixture/fixture"
import { SESSION_ID, malformedToolPartDocument, textPart, toolPart, userMessage } from "../fixture/import"

const sessionInfo: Session.Info = {
  id: SessionID.make(SESSION_ID),
  slug: "import-atomicity",
  projectID: ProjectV2.ID.global,
  directory: "/tmp",
  path: ".",
  title: "Import atomicity",
  version: "1.0.0",
  time: { created: 1000, updated: 1000 },
}

const row = () => Session.toRow(sessionInfo)

const use = <A, E>(effect: Effect.Effect<A, E, Database.Service>, file: string) =>
  Effect.runPromise(Effect.provide(Database.layerFromPath(file))(Effect.scoped(effect)))

test("rolls back the whole import when a part violates a foreign key", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "import.sqlite")

  await use(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make(tmp.path), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      // Schema-valid document, but message 1's part points at a message that is
      // never inserted — a referential integrity error the pre-flight decode
      // cannot catch. Only the transaction can keep this from being partial.
      const messages = decodeImportMessages([
        { info: userMessage(1), parts: [textPart("msg_000000000001", 1), toolPart("msg_999999999999", 2)] },
      ])

      const result = yield* Effect.exit(writeImport(db, row(), messages))
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        // Assert through the function the CLI actually ships, so the real chain from
        // the drizzle wrapper down to the sqlite reason stays covered.
        const failure = Cause.findErrorOption(result.cause)
        expect(Option.isSome(failure)).toBe(true)
        if (Option.isSome(failure)) expect(formatImportWriteError(failure.value)).toContain("FOREIGN KEY")
      }

      expect(yield* db.select().from(SessionTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect(yield* db.select().from(MessageTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect(yield* db.select().from(PartTable).all().pipe(Effect.orDie)).toHaveLength(0)
    }),
    file,
  )
})

test("reports the store write failure through importDocument and rolls back", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "import.sqlite")

  await use(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make(tmp.path), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      // The document is schema-valid — a part may reference any message id — so
      // pre-flight validation passes and the failure only happens at the part
      // insert inside the transaction. `importDocument` is what maps that failure
      // to the message the CLI prints, so calling it (rather than `writeImport`)
      // is what covers the wording the user actually sees.
      const document = [
        { info: userMessage(1), parts: [textPart("msg_000000000001", 1), toolPart("msg_999999999999", 2)] },
      ]

      const result = yield* Effect.exit(importDocument(db, row(), document))
      expect(result._tag).toBe("Failure")

      if (result._tag === "Failure") {
        const failure = Cause.findErrorOption(result.cause)
        expect(Option.isSome(failure)).toBe(true)
        if (Option.isSome(failure)) {
          const error = failure.value as { _tag: string; message: string }
          expect(error._tag).toBe("CliError")
          expect(error.message).toStartWith("Failed to write imported session:")
          expect(error.message).toContain("FOREIGN KEY")
        }
      }

      expect(yield* db.select().from(SessionTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect(yield* db.select().from(MessageTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect(yield* db.select().from(PartTable).all().pipe(Effect.orDie)).toHaveLength(0)
    }),
    file,
  )
})

test("never touches the store when the document fails pre-flight validation", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "import.sqlite")

  await use(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make(tmp.path), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      // `importDocument` owns the validate-then-write ordering, so calling it is
      // what makes this a real regression guard. Decoding inside the write loop
      // instead would report the same malformed part under a "Failed to write
      // imported session" prefix rather than the pre-flight one, and the counts
      // below would only hold because of the rollback rather than because
      // nothing was ever attempted.
      const result = yield* Effect.exit(importDocument(db, row(), malformedToolPartDocument()))
      expect(result._tag).toBe("Failure")

      if (result._tag === "Failure") {
        const failure = Cause.findErrorOption(result.cause)
        expect(Option.isSome(failure)).toBe(true)
        if (Option.isSome(failure)) {
          const error = failure.value as { _tag: string; message: string }
          expect(error._tag).toBe("CliError")
          expect(error.message).toContain("Invalid part 0 of message 1")
          expect(error.message).toContain("Invalid session document")
        }
      }

      expect(yield* db.select().from(SessionTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect(yield* db.select().from(MessageTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect(yield* db.select().from(PartTable).all().pipe(Effect.orDie)).toHaveLength(0)
    }),
    file,
  )
})

test("commits the session, messages and parts together for a valid document", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "import.sqlite")

  await use(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make(tmp.path), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      const messages = decodeImportMessages([
        { info: userMessage(1), parts: [textPart("msg_000000000001", 1)] },
        { info: userMessage(2), parts: [toolPart("msg_000000000002", 2)] },
      ])

      yield* writeImport(db, row(), messages)

      expect(yield* db.select().from(SessionTable).all().pipe(Effect.orDie)).toHaveLength(1)
      expect(yield* db.select().from(MessageTable).all().pipe(Effect.orDie)).toHaveLength(2)
      expect(yield* db.select().from(PartTable).all().pipe(Effect.orDie)).toHaveLength(2)

      // `id`/`sessionID` are lifted into real columns, so a destructuring change
      // here would silently corrupt the JSON blob. Assert the invariants rather
      // than a full `data` deep-equal, which would break on every schema change.
      // The rows are addressed by primary key: a `SELECT *` without an
      // `ORDER BY` has no guaranteed order, so `rows[0]` would depend on the
      // query plan rather than on the data.
      const first = yield* db
        .select()
        .from(MessageTable)
        .where(eq(MessageTable.id, MessageID.make("msg_000000000001")))
        .get()
        .pipe(Effect.orDie)
      expect(first?.time_created).toBe(userMessage(1).time.created)
      expect(first?.data).not.toHaveProperty("sessionID")
      expect(first?.data).not.toHaveProperty("id")

      const part = yield* db
        .select()
        .from(PartTable)
        .where(eq(PartTable.id, PartID.make("prt_000000000001")))
        .get()
        .pipe(Effect.orDie)
      expect(part?.message_id).toBe(messages[0]?.parts[0]?.messageID)
      expect(part?.session_id).toBe(row().id)
    }),
    file,
  )
})

test("re-importing the same document does not duplicate rows", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "import.sqlite")

  await use(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make(tmp.path), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      const messages = decodeImportMessages([
        { info: userMessage(1), parts: [textPart("msg_000000000001", 1)] },
        { info: userMessage(2), parts: [toolPart("msg_000000000002", 2)] },
      ])

      yield* writeImport(db, row(), messages)
      yield* writeImport(db, row(), messages)

      // The session row upserts, the message/part rows are conflict-ignored.
      expect(yield* db.select().from(SessionTable).all().pipe(Effect.orDie)).toHaveLength(1)
      expect(yield* db.select().from(MessageTable).all().pipe(Effect.orDie)).toHaveLength(2)
      expect(yield* db.select().from(PartTable).all().pipe(Effect.orDie)).toHaveLength(2)
    }),
    file,
  )
})

test("imports a session with no messages", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "import.sqlite")

  await use(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make(tmp.path), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      const messages = decodeImportMessages([])

      yield* writeImport(db, row(), messages)

      expect(yield* db.select().from(SessionTable).all().pipe(Effect.orDie)).toHaveLength(1)
      expect(yield* db.select().from(MessageTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect(yield* db.select().from(PartTable).all().pipe(Effect.orDie)).toHaveLength(0)
    }),
    file,
  )
})

test("reports a defect raised while writing as a readable CLI failure", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "import.sqlite")

  await use(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make(tmp.path), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      // `writeImport` reaches the store only through `transaction`, so a db whose
      // transaction dies stands in for a synchronous throw raised part-way through
      // the write — the case that would otherwise reach the user as a raw stack
      // trace instead of the import's own failure message.
      // oxlint-disable-next-line no-unsafe-type-assertion -- deliberate stub: only `transaction` is ever called
      const dying = {
        transaction: () => Effect.die(new TypeError("boom")),
      } as unknown as Database.Interface["db"]

      const result = yield* Effect.exit(importDocument(dying, row(), []))
      expect(result._tag).toBe("Failure")

      if (result._tag === "Failure") {
        const failure = Cause.findErrorOption(result.cause)
        expect(Option.isSome(failure)).toBe(true)
        if (Option.isSome(failure)) {
          const error = failure.value as { _tag: string; message: string }
          expect(error._tag).toBe("CliError")
          expect(error.message).toStartWith("Failed to write imported session:")
          expect(error.message).toContain("boom")
        }
      }

      // The dying transaction committed nothing, so the store is untouched.
      expect(yield* db.select().from(SessionTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect(yield* db.select().from(MessageTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect(yield* db.select().from(PartTable).all().pipe(Effect.orDie)).toHaveLength(0)
    }),
    file,
  )
})
