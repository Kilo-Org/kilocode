import { Database as SQLite } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloDatabase } from "../src/database"
import { copyConfig } from "../src/import/config"
import { cutoff } from "../src/import/since"

const dirs: string[] = []
const open: SQLite[] = []
afterEach(async () => {
  // Windows keeps an open file locked, so every connection closes before the directory is removed.
  for (const db of open.splice(0)) db.close()
  await Promise.all(dirs.splice(0).map(removeDir))
})

/** Windows also locks a path briefly after the last handle closes, so removal retries instead of failing the test. */
async function removeDir(dir: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 9 || (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY")) throw error
      await Bun.sleep(100)
    }
  }
}

/** A test directory with an empty kilo2 data directory; the Kilo v1 store goes in `kilo` beside it. */
async function root() {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-import-v1-")))
  dirs.push(dir)
  await mkdir(path.join(dir, "kilo2"))
  return { dir, data: path.join(dir, "kilo2") }
}

const model = { providerID: "kilo", modelID: "kilo-auto/free" }
const SECRET = {
  credential: "v1-credential-key-0b6f41",
  access: "v1-access-token-7d29ce",
  refresh: "v1-refresh-token-c3a18e",
  auth: "authjson-key-5e9b07",
  wellknown: "authjson-wellknown-token-91c4d2",
}
const user = (time: number, extra: object = {}) =>
  JSON.stringify({ role: "user", time: { created: time }, agent: "code", model, ...extra })
const assistant = (parent: string, time: number) =>
  JSON.stringify({
    role: "assistant",
    time: { created: time, completed: time + 1 },
    parentID: parent,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "code",
    agent: "code",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "stop",
  })

/**
 * A Kilo v1 store with the v1 schema and journal: a git session with a VS Code editor context and an assistant turn
 * that holds an ignored and a leftover transient part, a non-git session, and a provider credential. The writer stays
 * open with the rows in the WAL, as a running Kilo v1 keeps them. `updated` sets the session `time_updated`.
 */
async function v1Store(file: string, work: string, updated = 2) {
  const repo = path.join(work, "repo")
  const plain = path.join(work, "plain")
  await mkdir(repo, { recursive: true })
  await mkdir(plain, { recursive: true })
  await mkdir(path.dirname(file), { recursive: true })
  const db = new SQLite(file)
  open.push(db)
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA wal_autocheckpoint = 0")
  db.exec(await Bun.file(path.join(import.meta.dir, "fixture", "kilo-v1-schema.sql")).text())
  db.run(
    "INSERT INTO project (id, worktree, vcs, time_created, time_updated, sandboxes) VALUES (?, ?, 'git', 1, 2, '[]')",
    ["prj_repo", repo],
  )
  db.run("INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', '/', 1, 2, '[]')")
  db.run(
    "INSERT INTO workspace (id, type, project_id, directory, time_used) VALUES ('wrk_v1', 'worktree', 'prj_repo', ?, 1)",
    [repo],
  )
  // Kilo v1 stores the session path relative to its project worktree, which is `/` for the global project.
  for (const [id, project, directory, subpath, workspace] of [
    ["ses_repo", "prj_repo", repo, "", "wrk_v1"],
    ["ses_plain", "global", plain, path.relative("/", plain).replaceAll("\\", "/"), null],
  ]) {
    db.run(
      "INSERT INTO session (id, project_id, workspace_id, slug, directory, path, title, version, agent, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, '7.0.0', 'code', ?, 1, ?)",
      [
        id,
        project,
        workspace,
        id,
        directory,
        subpath,
        `Title ${id}`,
        JSON.stringify({ id: model.modelID, providerID: model.providerID }),
        updated,
      ],
    )
    db.run("INSERT INTO message VALUES (?, ?, 10, 10, ?)", [
      `msg_${id}_user`,
      id,
      user(10, id === "ses_repo" ? { editorContext: { activeFile: "src/app.ts", openTabs: ["src/app.ts"] } } : {}),
    ])
    db.run("INSERT INTO part VALUES (?, ?, ?, 10, 10, ?)", [
      `prt_${id}_user`,
      `msg_${id}_user`,
      id,
      JSON.stringify({ type: "text", text: `hello from ${id}` }),
    ])
  }
  db.run("INSERT INTO message VALUES ('msg_ses_repo_reply', 'ses_repo', 20, 21, ?)", [
    assistant("msg_ses_repo_user", 20),
  ])
  for (const [id, part] of [
    ["prt_reply_1", { type: "text", text: "the real answer" }],
    ["prt_reply_2", { type: "text", text: "hidden note", ignored: true }],
    [
      "prt_reply_3",
      { type: "text", text: "⠋ Initializing snapshot…", metadata: { "kilocode.lifecycle": "transient" } },
    ],
  ] as const)
    db.run("INSERT INTO part VALUES (?, 'msg_ses_repo_reply', 'ses_repo', 20, 21, ?)", [id, JSON.stringify(part)])
  db.run(
    "INSERT INTO credential (id, integration_id, label, value, active, time_created, time_updated) VALUES ('crd_v1', 'anthropic', 'v1 key', ?, 1, 1, 1)",
    [JSON.stringify({ type: "key", key: SECRET.credential })],
  )
  db.run(
    "INSERT INTO account (id, email, url, access_token, refresh_token, time_created, time_updated) VALUES ('acc_v1', 'user@example.com', 'https://kilo.ai', ?, ?, 1, 1)",
    [SECRET.access, SECRET.refresh],
  )
  return { db, repo, plain }
}

/**
 * A v1 store with a session tree: one recent session with an old child and a recent grandchild, one recent child of an
 * old parent, and one old session that no recent session reaches.
 */
async function windowStore(file: string, work: string, now: number) {
  await mkdir(path.dirname(file), { recursive: true })
  await mkdir(work, { recursive: true })
  const db = new SQLite(file)
  open.push(db)
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA wal_autocheckpoint = 0")
  db.exec(await Bun.file(path.join(import.meta.dir, "fixture", "kilo-v1-schema.sql")).text())
  db.run(
    "INSERT INTO project (id, worktree, vcs, time_created, time_updated, sandboxes) VALUES ('prj_window', ?, 'git', 1, 2, '[]')",
    [work],
  )
  const day = 86_400_000
  for (const [id, parent, updated] of [
    ["ses_old_root", null, now - 40 * day],
    ["ses_unrelated", null, now - 30 * day],
    ["ses_recent", null, now],
    ["ses_child_of_old", "ses_old_root", now],
    ["ses_child_of_recent", "ses_recent", now - 20 * day],
    ["ses_grandchild", "ses_child_of_recent", now],
  ] as const)
    db.run(
      "INSERT INTO session (id, project_id, parent_id, slug, directory, path, title, version, agent, model, time_created, time_updated) VALUES (?, 'prj_window', ?, ?, ?, '', ?, '7.0.0', 'code', ?, 1, ?)",
      [
        id,
        parent,
        id,
        work,
        `Title ${id}`,
        JSON.stringify({ id: model.modelID, providerID: model.providerID }),
        updated,
      ],
    )
  // A message, a part and a board for a session inside the window and one outside it, so the copy proves which tables it
  // filters. The event journal is filled too, because it is the one table that is never copied.
  for (const [id, inside] of [
    ["ses_recent", true],
    ["ses_unrelated", false],
  ] as const) {
    db.run("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, 1, 2, '{}')", [
      `msg_${id}`,
      id,
    ])
    db.run(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, 1, 2, '{}')",
      [`prt_${id}`, `msg_${id}`, id],
    )
    db.run("INSERT INTO kilo_board (root_session_id, objective, time_created, time_updated) VALUES (?, ?, 1, 2)", [
      id,
      `Objective ${id}`,
    ])
    db.run(
      "INSERT INTO kilo_board_message (id, board_root_session_id, seq, time_created, sender_session_id, recipient, type, body, source_message_id, source_call_id) VALUES (?, ?, 1, 1, ?, 'all', 'note', ?, '', '')",
      [`bmsg_${id}`, id, id, inside ? "inside" : "outside"],
    )
    db.run("INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, ?, 1, 'session.updated', '{}')", [
      `evt_${id}`,
      id,
    ])
  }
  return db
}

/**
 * The v1 files with the hash of each data file. `-shm` is SQLite's shared-memory index: every reader, Kilo v1 too,
 * updates its read marks, and it holds no session data. It must stay present, but its bytes are not compared.
 */
async function hashes(dir: string) {
  const names = (await readdir(dir)).filter((name) => name.startsWith("kilo.db")).sort()
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        name,
        name.endsWith("-shm")
          ? "present"
          : createHash("sha256")
              .update(await readFile(path.join(dir, name)))
              .digest("hex"),
      ]),
    ),
  )
}

/** Runs `fn` on the store; a converted store is in WAL mode, which a read-only connection cannot open without its WAL. */
function read<A>(file: string, fn: (db: SQLite) => A) {
  const db = new SQLite(file)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

const strays = async (data: string) =>
  (await readdir(data)).filter((name) => name.includes(".adopt") || name.endsWith(".lock"))

test("refuses a Kilo v1 store as the target, so a naming mistake cannot migrate the user's only copy", async () => {
  const { dir, data } = await root()
  const target = path.join(data, "kilo2.db")
  await v1Store(target, path.join(dir, "work"))
  const before = createHash("sha256")
    .update(await readFile(target))
    .digest("hex")
  await expect(KiloDatabase.refuseV1Store(target)).rejects.toThrow("Kilo v1 session store")
  // `KILO2_DB` reaches `select` as `OPENCODE_DB`, which must run the same guard as the default store file.
  await expect(KiloDatabase.select({ OPENCODE_DB: target }, { data, channel: "local" })).rejects.toThrow(
    "Kilo v1 session store",
  )
  expect(
    createHash("sha256")
      .update(await readFile(target))
      .digest("hex"),
  ).toBe(before)
})

test("a file that cannot be read stops the start instead of counting as a normal store", async () => {
  const { data } = await root()
  await writeFile(path.join(data, "kilo2-local.db"), "not a database")
  await expect(KiloDatabase.select({}, { data, channel: "local" })).rejects.toThrow("could not be read")
})

test("a Kilo v1 store is not adopted, so the start cannot create the store the guard refuses", async () => {
  const { dir, data } = await root()
  // The upstream-named file of an earlier build for this channel is the one `adopt` copies when no file has sessions.
  await v1Store(path.join(data, "opencode-local.db"), path.join(dir, "work"))
  expect(await KiloDatabase.select({}, { data, channel: "local" })).toBe(path.join(data, "kilo2-local.db"))
  expect(existsSync(path.join(data, "kilo2-local.db"))).toBe(false)
  expect(existsSync(path.join(data, "opencode-local.db"))).toBe(true)
})

test("the next start opens a store that was just imported, although it has no -wal or -shm file yet", async () => {
  const { dir, data } = await root()
  await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"))
  const file = await importStore(data)
  expect(existsSync(`${file}-wal`) || existsSync(`${file}-shm`)).toBe(false)
  expect(await KiloDatabase.select({}, { data, channel: "latest" })).toBe(file)
  expect(await KiloDatabase.select({ OPENCODE_DB: file }, { data, channel: "latest" })).toBe(file)
})

test("a v1 store at rest, after v1 closed it, is imported without creating files beside it", async () => {
  for (const since of [undefined, Date.now() - 7 * 86_400_000]) {
    const { dir, data } = await root()
    const v1 = await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"), Date.now())
    v1.db.run("PRAGMA wal_checkpoint(TRUNCATE)")
    // A copy of the checkpointed file is a store at rest: in WAL mode, with no -wal or -shm file beside it.
    const store = path.join(dir, "rest", "kilo.db")
    await mkdir(path.dirname(store), { recursive: true })
    await copyFile(KiloDatabase.v1Store(data), store)
    const before = await hashes(path.dirname(store))
    expect(await KiloDatabase.importV1({ store, file: path.join(data, "kilo2.db"), data, since })).toEqual({
      imported: 2,
      skipped: false,
    })
    expect(await hashes(path.dirname(store))).toEqual(before)
    expect(existsSync(`${store}-wal`) || existsSync(`${store}-shm`)).toBe(false)
  }
})

test("a v1 store from before the Kilo tables is still imported, and is not taken for a store to protect", async () => {
  const { dir, data } = await root()
  const store = KiloDatabase.v1Store(data)
  const v1 = await v1Store(store, path.join(dir, "work"))
  for (const table of ["kilo_board_message", "kilo_board", "kilo_continuation_intent"]) v1.db.run(`DROP TABLE ${table}`)
  await expect(KiloDatabase.refuseV1Store(store)).resolves.toBeUndefined()
  expect(await KiloDatabase.importV1({ store, file: path.join(data, "kilo2.db"), data })).toEqual({
    imported: 2,
    skipped: false,
  })
})

test("the import API returns the session count and reports an existing store as skipped", async () => {
  const { dir, data } = await root()
  const store = KiloDatabase.v1Store(data)
  await v1Store(store, path.join(dir, "work"))
  const file = path.join(data, "kilo2.db")
  expect(await KiloDatabase.importV1({ store, file, data })).toEqual({ imported: 2, skipped: false })
  expect(await KiloDatabase.importV1({ store, file, data })).toEqual({ imported: 0, skipped: true })
  expect(await strays(data)).toEqual([])
})

test("the Kilo-specific steps: no hidden or transient text, editor context kept, no credentials", async () => {
  const { dir, data } = await root()
  await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"))
  // The v2 migration `import_legacy_credentials` imports an `auth.json` of the data directory into the copy, and records
  // the origins of well-known entries in the `wellknown:sources` key.
  await writeFile(
    path.join(data, "auth.json"),
    JSON.stringify({
      openai: { type: "api", key: SECRET.auth },
      "https://models.example.com": { type: "wellknown", key: "EXAMPLE_TOKEN", token: SECRET.wellknown },
    }),
  )
  const file = await importStore(data)
  // Deleted rows must not stay readable in free pages of the file that is linked into place.
  const bytes = Buffer.from(await readFile(file)).toString("latin1")
  for (const secret of Object.values(SECRET)) expect(bytes).not.toContain(secret)
  expect(await Bun.file(`${file}-wal`).exists()).toBe(false)
  read(file, (db) => {
    const reply = db.query<{ data: string }, []>("SELECT data FROM session_message WHERE type = 'assistant'").get()!
    expect(reply.data).toContain("the real answer")
    expect(reply.data).not.toContain("hidden note")
    expect(reply.data).not.toContain("Initializing snapshot")
    const prompt = db
      .query<{ data: string }, []>("SELECT data FROM session_message WHERE id = 'msg_ses_repo_user'")
      .get()!
    expect(JSON.parse(prompt.data).metadata["kilocode.editorContext"]).toEqual({
      activeFile: "src/app.ts",
      openTabs: ["src/app.ts"],
    })
    expect(db.query("SELECT count(*) AS n FROM credential").get()).toEqual({ n: 0 })
    expect(db.query("SELECT count(*) AS n FROM account").get()).toEqual({ n: 0 })
    expect(db.query("SELECT value FROM kv WHERE key = 'wellknown:sources'").get()).toBeNull()
  })
})

test("a part with malformed JSON does not stop the import", async () => {
  const { dir, data } = await root()
  const source = await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"))
  source.db.run(
    "INSERT INTO part VALUES ('prt_broken', 'msg_ses_plain_user', 'ses_plain', 11, 11, '{\"type\":\"text\",')",
  )
  const file = await importStore(data)
  read(file, (db) => expect(db.query("SELECT count(*) AS n FROM session_v2").get()).toEqual({ n: 2 }))
})

test("an import lock that cannot be taken fails the import instead of writing a store", async () => {
  const { dir, data } = await root()
  const store = KiloDatabase.v1Store(data)
  await v1Store(store, path.join(dir, "work"))
  const file = path.join(data, "kilo2.db")
  await mkdir(`${file}.import.lock`)
  await expect(KiloDatabase.importV1({ store, file, data })).rejects.toThrow()
  expect(await Bun.file(file).exists()).toBe(false)
})

test("a lock of a live process that stopped reporting progress is taken over", async () => {
  const { dir, data } = await root()
  const store = KiloDatabase.v1Store(data)
  await v1Store(store, path.join(dir, "work"))
  const file = path.join(data, "kilo2.db")
  // A live PID (this process) whose lock has not been touched for ten minutes: a stuck owner or a reused PID.
  await writeFile(`${file}.import.lock`, String(process.pid))
  const old = new Date(Date.now() - 10 * 60_000)
  await utimes(`${file}.import.lock`, old, old)
  expect(await KiloDatabase.importV1({ store, file, data })).toEqual({ imported: 2, skipped: false })
  expect(await strays(data)).toEqual([])
})

test("parallel imports convert once, and a lock of a process that no longer runs is taken over", async () => {
  const { dir, data } = await root()
  const store = KiloDatabase.v1Store(data)
  await v1Store(store, path.join(dir, "work"))
  const file = path.join(data, "kilo2.db")
  // A crashed import: its lock names a process ID that cannot be running.
  await writeFile(`${file}.import.lock`, "2147483646")
  const results = await Promise.all([0, 1, 2].map(() => KiloDatabase.importV1({ store, file, data })))
  expect(results.filter((result) => !result.skipped)).toEqual([{ imported: 2, skipped: false }])
  read(file, (db) => expect(db.query("SELECT count(*) AS n FROM session_v2").get()).toEqual({ n: 2 }))
  expect(await strays(data)).toEqual([])
})

test("the v1 files stay byte-identical", async () => {
  const { dir, data } = await root()
  await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"))
  const before = await hashes(path.join(dir, "kilo"))
  await importStore(data)
  expect(await hashes(path.join(dir, "kilo"))).toEqual(before)
})

test("after the release renames the data directory to kilo, the default source is the kilo.db in it", async () => {
  const { dir } = await root()
  const data = path.join(dir, "kilo")
  await v1Store(path.join(data, "kilo.db"), path.join(dir, "work"))
  expect(KiloDatabase.v1Store(data)).toBe(path.join(data, "kilo.db"))
  const file = path.join(data, "kilo2.db")
  expect(await KiloDatabase.importV1({ store: KiloDatabase.v1Store(data), file, data })).toEqual({
    imported: 2,
    skipped: false,
  })
  read(file, (db) => expect(db.query("SELECT count(*) AS n FROM session_v2").get()).toEqual({ n: 2 }))
})

test("--since parses durations and ISO dates", () => {
  const now = Date.UTC(2026, 10, 10, 12)
  expect(cutoff("36h", now)).toBe(now - 36 * 3_600_000)
  expect(cutoff("14d", now)).toBe(now - 14 * 86_400_000)
  expect(cutoff("2w", now)).toBe(now - 14 * 86_400_000)
  expect(cutoff("2026-10-27", now)).toBe(Date.parse("2026-10-27"))
})

test("--since rejects invalid values", () => {
  for (const value of ["", "foo", "14", "2x", "0d", "-3d", "2026-13-01", "27-10-2026"])
    expect(() => cutoff(value)).toThrow("Invalid --since")
})

test("--since imports the recent sessions and the complete parent and child tree", async () => {
  const { dir, data } = await root()
  const store = KiloDatabase.v1Store(data)
  const now = Date.now()
  await windowStore(store, path.join(dir, "work"), now)
  const file = path.join(data, "kilo2.db")
  expect(await KiloDatabase.importV1({ store, file, data, since: now - 7 * 86_400_000 })).toEqual({
    imported: 5,
    skipped: false,
  })
  const selected = ["ses_child_of_old", "ses_child_of_recent", "ses_grandchild", "ses_old_root", "ses_recent"]
  read(file, (db) => {
    expect(db.query("SELECT id FROM session_v2 ORDER BY id").all()).toEqual(selected.map((id) => ({ id })))
    // The legacy table of the private copy proves that the unrelated old session was never copied.
    expect(db.query("SELECT id FROM session ORDER BY id").all()).toEqual(selected.map((id) => ({ id })))
    // The session-scoped tables are filtered by their own column, including the board, which keys sessions by root id.
    expect(db.query("SELECT id FROM message").all()).toEqual([{ id: "msg_ses_recent" }])
    expect(db.query("SELECT id FROM part").all()).toEqual([{ id: "prt_ses_recent" }])
    expect(db.query("SELECT root_session_id FROM kilo_board").all()).toEqual([{ root_session_id: "ses_recent" }])
    expect(db.query("SELECT body FROM kilo_board_message").all()).toEqual([{ body: "inside" }])
    // The event journal is never copied: it carries no `session_id`, and the conversion clears it anyway.
    expect(db.query("SELECT count(*) AS n FROM event").get()).toEqual({ n: 0 })
    // The copy recreates the v1 indexes, including ones on an expression and a partial one.
    for (const name of ["recall_part_search_idx", "part_session_step_finish_idx", "kilo_board_message_board_seq_idx"])
      expect(db.query("SELECT 1 AS ok FROM sqlite_master WHERE type = 'index' AND name = ?").get(name)).toEqual({
        ok: 1,
      })
  })
})

test("--since leaves the v1 files byte-identical and still applies the Kilo steps", async () => {
  const { dir, data } = await root()
  await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"), Date.now())
  const before = await hashes(path.join(dir, "kilo"))
  const file = await importStore(data, Date.now() - 7 * 86_400_000)
  expect(await hashes(path.join(dir, "kilo"))).toEqual(before)
  read(file, (db) => {
    expect(db.query("SELECT count(*) AS n FROM session_v2").get()).toEqual({ n: 2 })
    expect(db.query("SELECT count(*) AS n FROM credential").get()).toEqual({ n: 0 })
    expect(db.query("SELECT count(*) AS n FROM account").get()).toEqual({ n: 0 })
    const reply = db.query<{ data: string }, []>("SELECT data FROM session_message WHERE type = 'assistant'").get()!
    expect(reply.data).not.toContain("hidden note")
    expect(reply.data).not.toContain("Initializing snapshot")
  })
})

test("--since with an empty window fails instead of publishing an empty store", async () => {
  const { dir, data } = await root()
  await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"), Date.now())
  const file = path.join(data, "kilo2.db")
  const since = Date.now() + 86_400_000
  await expect(KiloDatabase.importV1({ store: KiloDatabase.v1Store(data), file, data, since })).rejects.toThrow(
    "No Kilo v1 sessions were updated since",
  )
  expect(existsSync(file)).toBe(false)
})

/** Imports the v1 store beside `data` into `<data>/kilo2.db`, the way the command does without `--from`. */
async function importStore(data: string, since?: number) {
  const file = path.join(data, "kilo2.db")
  await KiloDatabase.importV1({ store: KiloDatabase.v1Store(data), file, data, since })
  return file
}

test("an existing store gets only the v1 sessions it does not have, in the project it already lists", async () => {
  const { dir, data } = await root()
  const store = KiloDatabase.v1Store(data)
  const now = Date.now()
  await windowStore(store, path.join(dir, "work"), now)
  const file = await importStore(data, now - 7 * 86_400_000)
  // kilo2 changed an imported session, and knows the project under its own ID.
  read(file, (db) => {
    db.run("UPDATE session_v2 SET title = 'kept' WHERE id = 'ses_recent'")
    db.run("UPDATE project SET id = 'prj_v2' WHERE id = 'prj_window'")
    db.run("UPDATE session_v2 SET project_id = 'prj_v2' WHERE project_id = 'prj_window'")
  })
  expect(await KiloDatabase.mergeV1({ store, file, data })).toBe(1)
  read(file, (db) => {
    expect(db.query("SELECT project_id FROM session_v2 WHERE id = 'ses_unrelated'").get()).toEqual({
      project_id: "prj_v2",
    })
    expect(db.query("SELECT title FROM session_v2 WHERE id = 'ses_recent'").get()).toEqual({ title: "kept" })
    expect(db.query("SELECT count(*) AS n FROM project WHERE id = 'prj_window'").get()).toEqual({ n: 0 })
    for (const table of ["session_v2", "session_message"])
      expect(db.query(`PRAGMA foreign_key_check(${table})`).all()).toEqual([])
    expect(db.query("SELECT count(*) AS n FROM event_sequence WHERE aggregate_id = 'ses_unrelated'").get()).toEqual({
      n: 1,
    })
  })
  expect(await KiloDatabase.mergeV1({ store, file, data })).toBe(0)
  expect((await readdir(data)).filter((name) => name.includes(".import"))).toEqual([])
})

test("--config copies the v1 global config without overwriting kilo2 files", async () => {
  const { dir } = await root()
  const from = path.join(dir, "config", "kilo")
  const to = path.join(dir, "config", "kilo2")
  await mkdir(path.join(from, "skills", "shared"), { recursive: true })
  await mkdir(path.join(from, "skills", "v1-only"), { recursive: true })
  await mkdir(path.join(from, "plugins"), { recursive: true })
  await mkdir(path.join(to, "skills", "shared"), { recursive: true })
  await writeFile(path.join(from, "kilo.jsonc"), '{ "model": "kilo/v1" }')
  await writeFile(path.join(from, "skills", "shared", "SKILL.md"), "v1")
  await writeFile(path.join(from, "skills", "v1-only", "SKILL.md"), "v1")
  await writeFile(path.join(from, "plugins", "plugin.ts"), "")
  await writeFile(path.join(to, "skills", "shared", "SKILL.md"), "kilo2")
  expect(copyConfig(from, to)).toEqual(["kilo.jsonc", "skills"])
  expect(await readFile(path.join(to, "kilo2.jsonc"), "utf8")).toBe('{ "model": "kilo/v1" }')
  expect(await readFile(path.join(to, "skills", "shared", "SKILL.md"), "utf8")).toBe("kilo2")
  expect(await readFile(path.join(to, "skills", "v1-only", "SKILL.md"), "utf8")).toBe("v1")
  expect(existsSync(path.join(to, "plugins"))).toBe(false)
  // Once kilo2 has its own config file, the v1 file stays out.
  await rm(path.join(to, "kilo2.jsonc"))
  await writeFile(path.join(to, "kilo2.json"), "{}")
  expect(copyConfig(from, to)).toEqual(["skills"])
  expect(existsSync(path.join(to, "kilo2.jsonc"))).toBe(false)
})
