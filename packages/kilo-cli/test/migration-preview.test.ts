import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { reconcilePreview } from "../src/migration/preview"

const schema = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE session_v2 (id TEXT PRIMARY KEY, title TEXT);
  CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT REFERENCES session_v2, body TEXT COLLATE NOCASE);
  CREATE TABLE credential (id TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE kilo_board_message (board TEXT, seq INTEGER, data BLOB, PRIMARY KEY(board, seq)) WITHOUT ROWID;
  CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER, owner_id TEXT);
  CREATE TABLE _tools (value);
  CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);
`
const common = `
  INSERT INTO session_v2 VALUES ('shared', 'Shared session');
  INSERT INTO session_message VALUES ('message', 'shared', 'lowercase');
  INSERT INTO migration VALUES ('known', 1);
`

function run(file: string, sql: string) {
  using db = new Database(file)
  db.exec(sql)
}

function fixture(root: string) {
  const previews = path.join(root, "previews")
  mkdirSync(previews)
  const target = path.join(root, "private-candidate.db")
  const preview = path.join(previews, "kilo2-# preview.db")
  run(target, schema + common)
  copyFileSync(target, preview)
  return { target, preview, previews }
}

function snapshot(root: string) {
  return [".", ...readdirSync(root, { recursive: true, encoding: "utf8" }).sort()].map((name) => {
    const file = path.join(root, name)
    const stat = statSync(file, { bigint: true })
    return [
      name,
      stat.mode,
      stat.mtimeNs,
      stat.isFile() && createHash("sha256").update(readFileSync(file)).digest("hex"),
    ]
  })
}

test("keeps a candidate containing both an empty and an already-represented preview without any writes", async () => {
  await using dir = await tmpdir()
  const { target, preview, previews } = fixture(dir.path)
  run(target, "CREATE TABLE legacy(data); INSERT INTO legacy VALUES ('keep')")
  const empty = path.join(previews, "kilo2-empty.db")
  run(empty, schema)
  const before = snapshot(dir.path)
  reconcilePreview(target, [empty, preview])
  expect(snapshot(dir.path)).toEqual(before)
})

test("a dominating preview becomes a detached private copy including credentials, board, tools and sync state", async () => {
  await using dir = await tmpdir()
  const { target, preview, previews } = fixture(dir.path)
  const sibling = path.join(previews, "kilo2-local.db")
  copyFileSync(target, sibling)
  const early = "INSERT INTO event_sequence VALUES ('shared', 9007199254740993, 'owner');"
  run(sibling, early)
  run(
    preview,
    early +
      `
    INSERT INTO session_v2 VALUES ('extra', 'New preview session');
    INSERT INTO session_message VALUES ('reply', 'extra', 'New text');
    INSERT INTO credential VALUES ('credential', 'fixture-token');
    INSERT INTO kilo_board_message VALUES ('shared', 1, X'CAFE00');
    INSERT INTO _tools VALUES ('same'), ('same');
  `,
  )
  const originals = snapshot(previews)
  reconcilePreview(target, [sibling, preview])
  expect(readFileSync(target).equals(readFileSync(preview))).toBe(true)
  if (process.platform !== "win32") expect(statSync(target).mode & 0o777).toBe(0o600)
  run(target, "DELETE FROM _tools")
  expect(snapshot(previews)).toEqual(originals)
})

test.each([
  ["session_message", "UPDATE session_message SET body = 'LOWERCASE'"],
  ["event_sequence", "INSERT INTO event_sequence VALUES ('shared', 2, 'sync')"],
  ["credential", "INSERT INTO credential VALUES ('private', 'do-not-print')"],
  ["kilo_board_message", "INSERT INTO kilo_board_message VALUES ('b', 1, X'CAFE')"],
  ["_tools", "INSERT INTO _tools VALUES (1), (1)"],
])("independent %s content is a blocking conflict even when session IDs match", async (table, change) => {
  await using dir = await tmpdir()
  const { target, preview } = fixture(dir.path)
  run(target, "INSERT INTO session_v2 VALUES ('left', 'left'), ('right', 'right'), ('last', 'last')")
  run(preview, change)
  const before = snapshot(dir.path)
  const error = () => reconcilePreview(target, [preview])
  expect(error).toThrow(`rows in "${table}"`)
  expect(error).toThrow(preview)
  expect(error).toThrow(target)
  expect(error).not.toThrow("do-not-print")
  expect(snapshot(dir.path)).toEqual(before)
})

test.each([
  ["CREATE TABLE _unknown(value); INSERT INTO _unknown VALUES ('secret')", "_unknown"],
  ["ALTER TABLE _tools ADD COLUMN new_format", "_tools"],
  ["INSERT INTO migration VALUES ('unrecognized-data-migration', 1000)", "migrations"],
  ["PRAGMA user_version = 700", "user version"],
])("refuses changed schema or protocol metadata (%s)", async (sql, reason) => {
  await using dir = await tmpdir()
  const { target, preview } = fixture(dir.path)
  run(preview, sql!)
  const before = snapshot(dir.path)
  expect(() => reconcilePreview(target, [preview])).toThrow(reason!)
  expect(snapshot(dir.path)).toEqual(before)
})

test("reports an unreadable later preview before replacing the candidate", async () => {
  await using dir = await tmpdir()
  const { target, preview, previews } = fixture(dir.path)
  run(preview, "INSERT INTO session_v2 VALUES ('another', 'Another')")
  const corrupt = path.join(previews, "kilo2-corrupt.db")
  writeFileSync(corrupt, "damaged fixture")
  const before = snapshot(dir.path)
  expect(() => reconcilePreview(target, [preview, corrupt])).toThrow(corrupt)
  expect(snapshot(dir.path)).toEqual(before)
})

test("a WAL-backed preview is never inspected without its committed WAL, or checkpointed", async () => {
  await using dir = await tmpdir()
  const { target, preview, previews } = fixture(dir.path)
  const writer = path.join(dir.path, "writer.db")
  copyFileSync(preview, writer)
  using db = new Database(writer)
  db.exec("PRAGMA wal_autocheckpoint=0; INSERT INTO credential VALUES ('only-in-WAL', 'secret')")
  // No -shm on the preview; even transiently opening normal read-only here can dirty the directory.
  copyFileSync(writer, preview)
  copyFileSync(`${writer}-wal`, `${preview}-wal`)
  const before = snapshot(previews)
  expect(() => reconcilePreview(target, [preview])).toThrow(`${preview}-wal`)
  expect(snapshot(previews)).toEqual(before)
})

test("refuses an alias of the candidate", async () => {
  await using dir = await tmpdir()
  const { target, previews } = fixture(dir.path)
  const alias = path.join(previews, "kilo2-alias.db")
  linkSync(target, alias)
  const before = snapshot(dir.path)
  expect(() => reconcilePreview(target, [alias])).toThrow("aliases candidate")
  expect(snapshot(dir.path)).toEqual(before)
})
