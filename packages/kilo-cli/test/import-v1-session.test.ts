import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { copyV1Store, inspectV1Source } from "../src/import-v1-session"

// Synthetic V1 stores are shaped by the audited origin/main DDL in
// fixtures/v1-session/schema.sql; see kilocode/baseline/v1-session-schema-audit.md.

const schema = await Bun.file(path.join(import.meta.dir, "fixtures", "v1-session", "schema.sql")).text()

const MIGRATIONS = [
  "20260127222353_familiar_lady_ursula",
  "20260211171708_add_project_commands",
  "20260213144116_wakeful_the_professor",
  "20260225215848_workspace",
  "20260227213759_add_session_workspace_id",
  "20260228203230_blue_harpoon",
  "20260303231226_add_workspace_fields",
  "20260309230000_move_org_to_state",
  "20260312043431_session_message_cursor",
  "20260323234822_events",
  "20260410174513_workspace-name",
  "20260413175956_chief_energizer",
  "20260423070820_add_icon_url_override",
  "20260427172553_slow_nightmare",
  "20260428004200_add_session_path",
  "20260501142318_next_venus",
  "20260504145000_add_sync_owner",
  "20260507164347_add_workspace_time",
  "20260510033149_session_usage",
  "20260511000411_data_migration_state",
  "20260511173437_session-metadata",
  "20260601010001_normalize_storage_paths",
  "20260601202201_amazing_prowler",
  "20260602002951_lowly_union_jack",
  "20260602182828_add_project_directories",
  "20260603001617_session_message_projection_indexes",
  "20260603040000_session_message_projection_order",
  "20260603141458_session_input_inbox",
  "20260603160727_jittery_ezekiel_stane",
  "20260604172448_event_sourced_session_input",
  "20260605003541_add_session_context_snapshot",
  "20260605042240_add_context_epoch_agent",
  "20260611035744_credential",
  "20260611192811_lush_chimera",
  "20260612174303_project_dir_strategy",
  "20260622142730_simplify_session_context_epoch",
  "20260622170816_reset_v2_session_state",
  "20260622202450_simplify_session_input",
  "20260714141136_session-message-legacy-writer-compat",
  "20260828074139_kilocode_board",
]

const TOOL_PART = {
  type: "tool",
  callID: "call_1",
  tool: "bash",
  state: {
    status: "completed",
    input: { command: "echo hi", description: "greet" },
    output: "hi\n",
    metadata: {},
    time: { start: 11, end: 12 },
  },
}

function seed(db: Database) {
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  db.exec(schema)
  const insertMigration = db.prepare("INSERT INTO migration (id, time_completed) VALUES (?, 1)")
  for (const id of MIGRATIONS) insertMigration.run(id)
  db.prepare(
    "INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('prj_1', '/tmp/project', 1, 1, '[]')",
  ).run()
  db.prepare(
    `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
     VALUES ('ses_1', 'prj_1', 'test', '/tmp/project', 'Fixture session', '1.0.0', 10, 20)`,
  ).run()
  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_user', 'ses_1', 10, 11, ?)`,
  ).run(
    JSON.stringify({
      role: "user",
      time: { created: 10 },
      agent: "build",
      model: { providerID: "kilo", modelID: "model" },
    }),
  )
  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_assistant', 'ses_1', 20, 25, ?)`,
  ).run(
    JSON.stringify({
      role: "assistant",
      time: { created: 20, completed: 25 },
      parentID: "msg_user",
      modelID: "model",
      providerID: "kilo",
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp/project", root: "/tmp/project" },
      cost: 0.5,
      tokens: { total: 10, input: 2, output: 3, reasoning: 4, cache: { read: 5, write: 6 } },
    }),
  )
  db.prepare(
    "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('prt_1', 'msg_user', 'ses_1', 10, 10, ?)",
  ).run(JSON.stringify({ type: "text", text: "hello from v1" }))
  db.prepare(
    "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('prt_2', 'msg_assistant', 'ses_1', 20, 21, ?)",
  ).run(JSON.stringify(TOOL_PART))
  db.prepare(
    "INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES ('ses_1', 'pending item', 'pending', 'medium', 0, 10, 10)",
  ).run()
  db.prepare(
    "INSERT INTO session_share (session_id, id, secret, url, time_created, time_updated) VALUES ('ses_1', 'share_1', 'secret', 'https://share.example/ses_1', 10, 10)",
  ).run()
  db.prepare(
    "INSERT INTO kilo_board (root_session_id, objective, time_created, time_updated) VALUES ('ses_1', 'objective', 10, 10)",
  ).run()
}

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

async function store() {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-v1-import-test-"))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const sourceDir = path.join(root, "v1-store")
  const importDir = path.join(root, "kilo2")
  mkdirSync(sourceDir)
  mkdirSync(importDir)
  const source = path.join(sourceDir, "kilo.db")
  const writer = new Database(source, { create: true })
  seed(writer)
  cleanups.push(() => writer.close())
  return { root, source, writer, destination: path.join(importDir, "kilo2.db") }
}

describe("inspectV1Source", () => {
  test("rejects non-absolute, missing, symlinked, non-V1, and already-V2 sources", async () => {
    const { root, source } = await store()
    await expect(inspectV1Source("relative.db")).rejects.toThrow("must be absolute")
    await expect(inspectV1Source(path.join(root, "missing.db"))).rejects.toThrow("does not exist")
    const link = path.join(root, "link.db")
    symlinkSync(source, link)
    await expect(inspectV1Source(link)).rejects.toThrow("symlink")
    const foreign = path.join(root, "foreign.db")
    const other = new Database(foreign, { create: true })
    other.run("CREATE TABLE kv (key text PRIMARY KEY, value text)")
    other.close()
    await expect(inspectV1Source(foreign)).rejects.toThrow("Not a Kilo V1 session store")
    const migrated = path.join(root, "migrated.db")
    const v2 = new Database(migrated, { create: true })
    v2.exec(schema)
    v2.run("CREATE TABLE session_v2 (id text PRIMARY KEY)")
    v2.close()
    await expect(inspectV1Source(migrated)).rejects.toThrow("already contains V2 sessions")
  })

  test("reports counts and the V1 migration journal, including Kilo-only ids", async () => {
    const { source } = await store()
    const info = await inspectV1Source(source)
    expect(info.sessions).toBe(1)
    expect(info.messages).toBe(2)
    expect(info.parts).toBe(2)
    expect(info.migrations).toHaveLength(40)
    expect(info.migrations).toContain("20260828074139_kilocode_board")
    expect(info.migrations).toContain("20260714141136_session-message-legacy-writer-compat")
  })
})

describe("copyV1Store", () => {
  test("copies committed WAL content while the source writer stays open, preserving the source byte-for-byte", async () => {
    const { source, writer, destination } = await store()
    writer
      .prepare(
        "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_wal', 'ses_1', 30, 30, ?)",
      )
      .run(
        JSON.stringify({
          role: "user",
          time: { created: 30 },
          agent: "build",
          model: { providerID: "kilo", modelID: "model" },
        }),
      )
    const before = contentFiles(source).map((file) => readFileSync(file))

    const report = await copyV1Store({ source, destination })

    expect(report.source.sessions).toBe(1)
    expect(report.source.walBytes).toBeGreaterThan(0)
    expect(lstatSync(destination).size).toBeGreaterThan(0)
    expect(lstatSync(destination).mode & 0o777).toBe(0o600)
    const copied = new Database(destination, { readonly: true, strict: true })
    expect(copied.query("SELECT COUNT(*) AS c FROM message").get()).toEqual({ c: 3 })
    expect(copied.query("SELECT data FROM part WHERE id = 'prt_2'").get()).toEqual({ data: JSON.stringify(TOOL_PART) })
    // Leftover Kilo tables ride along untouched; the migrator owns their fate.
    expect(copied.query("SELECT content FROM todo WHERE session_id = 'ses_1'").get()).toEqual({
      content: "pending item",
    })
    expect(copied.query("SELECT url FROM session_share WHERE session_id = 'ses_1'").get()).toEqual({
      url: "https://share.example/ses_1",
    })
    expect(copied.query("SELECT objective FROM kilo_board WHERE root_session_id = 'ses_1'").get()).toEqual({
      objective: "objective",
    })
    expect(copied.query("SELECT COUNT(*) AS c FROM migration").get()).toEqual({ c: 40 })
    copied.close()
    contentFiles(source).forEach((file, index) => expect(readFileSync(file)).toEqual(before[index]))
    expect(readFileSync(destination).length).toBe(report.bytes)
  })

  test("rejects destination collisions, source self-copy, and store-directory placement", async () => {
    const { root, source, destination } = await store()
    writeFileSync(destination, "occupied")
    await expect(copyV1Store({ source, destination })).rejects.toThrow("already exists")
    expect(readFileSync(destination, "utf8")).toBe("occupied")
    await expect(copyV1Store({ source, destination: source })).rejects.toThrow("must not be the V1 source")
    await expect(copyV1Store({ source, destination: `${source}-wal` })).rejects.toThrow("must not be the V1 source")
    await expect(copyV1Store({ source, destination: path.join(path.dirname(source), "copy.db") })).rejects.toThrow(
      "outside the V1 store directory",
    )
    await expect(copyV1Store({ source, destination: path.join(root, "missing-dir", "copy.db") })).rejects.toThrow(
      "directory does not exist",
    )
    await expect(copyV1Store({ source, destination: "relative.db" })).rejects.toThrow("must be absolute")
  })

  test("aborts without publishing when the source changes mid-copy", async () => {
    const { root, source, writer, destination } = await store()
    await expect(
      copyV1Store({
        source,
        destination,
        onCopyComplete: () => {
          // A real concurrent write through the still-open V1 writer connection.
          writer.run(
            "INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES ('ses_1', 'concurrent', 'pending', 'low', 1, 40, 40)",
          )
        },
      }),
    ).rejects.toThrow("source changed during copy")
    expect(lstatSync(destination, { throwIfNoEntry: false })).toBeUndefined()
    // The staging directory is cleaned up; nothing import-shaped remains.
    expect(readdirSync(path.dirname(destination)).filter((entry) => entry.includes("import"))).toEqual([])
    expect(readdirSync(root).sort()).toEqual(["kilo2", "v1-store"])
  })

  test("copies a quiescent source with no WAL siblings", async () => {
    const { source, writer, destination } = await store()
    writer.run("PRAGMA wal_checkpoint(TRUNCATE)")
    writer.close()
    const info = await inspectV1Source(source)
    expect(info.walBytes).toBe(0)
    const report = await copyV1Store({ source, destination })
    expect(report.bytes).toBeGreaterThan(0)
    expect(lstatSync(destination).mode & 0o777).toBe(0o600)
    const copied = new Database(destination, { readonly: true, strict: true })
    expect(copied.query("SELECT COUNT(*) AS c FROM session").get()).toEqual({ c: 1 })
    copied.close()
  })
})

function contentFiles(filename: string) {
  return [filename, `${filename}-wal`]
}
