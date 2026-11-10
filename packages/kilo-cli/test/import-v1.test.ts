import { Database as SQLite } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloDatabase } from "../src/database"

const dirs: string[] = []
const open: SQLite[] = []
afterEach(async () => {
  // Windows keeps an open file locked, so every connection closes before the directory is removed.
  for (const db of open.splice(0)) db.close()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

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
 * open with the rows in the WAL, as a running Kilo v1 keeps them.
 */
async function v1Store(file: string, work: string) {
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
      "INSERT INTO session (id, project_id, workspace_id, slug, directory, path, title, version, agent, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, '7.0.0', 'code', ?, 1, 2)",
      [
        id,
        project,
        workspace,
        id,
        directory,
        subpath,
        `Title ${id}`,
        JSON.stringify({ id: model.modelID, providerID: model.providerID }),
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
  expect(
    createHash("sha256")
      .update(await readFile(target))
      .digest("hex"),
  ).toBe(before)
})

test("the import API returns the session count and reports an existing store as skipped", async () => {
  const { dir, data } = await root()
  const store = KiloDatabase.v1Store(data)
  await v1Store(store, path.join(dir, "work"))
  const file = path.join(data, "kilo2.db")
  expect(await KiloDatabase.importV1({ store, file, data })).toEqual({ imported: 2, skipped: false })
  expect(await KiloDatabase.importV1({ store, file, data })).toEqual({ imported: 0, skipped: true })
})

test("the first start converts the Kilo v1 store into v2 sessions before the store is reachable", async () => {
  const { dir, data } = await root()
  const source = await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"))
  expect(KiloDatabase.v1Store(data)).toBe(path.join(dir, "kilo", "kilo.db"))

  const file = await KiloDatabase.select({}, { data, channel: "latest" })
  expect(file).toBe(path.join(data, "kilo2.db"))
  read(file, (db) => {
    expect(db.query("SELECT value FROM kv WHERE key = 'migration.v1-v2'").get()).toEqual({
      value: '{"phase":"completed"}',
    })
    expect(db.query("SELECT id, project_id, workspace_id, directory, path FROM session_v2 ORDER BY id").all()).toEqual([
      // The non-git session leaves the v1 global project for the project of its own directory, with an empty path.
      {
        id: "ses_plain",
        project_id: expect.not.stringMatching(/^global$/),
        workspace_id: null,
        directory: source.plain,
        path: "",
      },
      { id: "ses_repo", project_id: "prj_repo", workspace_id: null, directory: source.repo, path: "" },
    ])
    expect(db.query("SELECT session_id, type FROM session_message ORDER BY session_id, seq").all()).toEqual([
      { session_id: "ses_plain", type: "user" },
      { session_id: "ses_repo", type: "user" },
      { session_id: "ses_repo", type: "assistant" },
    ])
  })
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
  const file = await KiloDatabase.select({}, { data, channel: "latest" })
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
  const file = await KiloDatabase.select({}, { data, channel: "latest" })
  read(file, (db) => expect(db.query("SELECT count(*) AS n FROM session_v2").get()).toEqual({ n: 2 }))
})

test("a lock that cannot be taken starts a new database instead of waiting", async () => {
  const { dir, data } = await root()
  await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"))
  const file = path.join(data, "kilo2.db")
  await mkdir(`${file}.import.lock`)
  expect(await KiloDatabase.select({}, { data, channel: "latest" })).toBe(file)
  expect(await Bun.file(file).exists()).toBe(false)
})

test("a lock of a live process that stopped reporting progress is taken over", async () => {
  const { dir, data } = await root()
  await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"))
  const file = path.join(data, "kilo2.db")
  // A live PID (this process) whose lock has not been touched for ten minutes: a stuck owner or a reused PID.
  await writeFile(`${file}.import.lock`, String(process.pid))
  const old = new Date(Date.now() - 10 * 60_000)
  await utimes(`${file}.import.lock`, old, old)
  await KiloDatabase.select({}, { data, channel: "latest" })
  read(file, (db) => expect(db.query("SELECT count(*) AS n FROM session_v2").get()).toEqual({ n: 2 }))
  expect(await strays(data)).toEqual([])
})

test("the v1 files stay byte-identical", async () => {
  const { dir, data } = await root()
  await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"))
  const before = await hashes(path.join(dir, "kilo"))
  await KiloDatabase.select({}, { data, channel: "v2" })
  expect(await hashes(path.join(dir, "kilo"))).toEqual(before)
})

test("parallel starts convert once, and a lock of a process that no longer runs is taken over", async () => {
  const { dir, data } = await root()
  await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"))
  const file = path.join(data, "kilo2.db")
  // A crashed import: its lock names a process ID that cannot be running.
  await writeFile(`${file}.import.lock`, "2147483646")
  const files = await Promise.all([0, 1, 2].map(() => KiloDatabase.select({}, { data, channel: "latest" })))
  expect(files).toEqual([file, file, file])
  read(file, (db) => expect(db.query("SELECT count(*) AS n FROM session_v2").get()).toEqual({ n: 2 }))
  expect(await strays(data)).toEqual([])
})

test("an existing store, KILO_DISABLE_V1_IMPORT, or a source that is not a v1 store leave the v1 sessions out", async () => {
  const { dir, data } = await root()
  await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"))

  const disabled = await KiloDatabase.select({ KILO_DISABLE_V1_IMPORT: "1" }, { data, channel: "v2" })
  expect(await Bun.file(disabled).exists()).toBe(false)

  const existing = new SQLite(path.join(data, "kilo2.db"))
  existing.run("CREATE TABLE session_v2 (id TEXT)")
  existing.close()
  await KiloDatabase.select({}, { data, channel: "latest" })
  read(path.join(data, "kilo2.db"), (db) =>
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'session'").get()).toBeNull(),
  )

  const other = await root()
  await mkdir(path.join(other.dir, "kilo"))
  const v2 = new SQLite(KiloDatabase.v1Store(other.data))
  v2.run("CREATE TABLE session_v2 (id TEXT)")
  v2.close()
  const fresh = await KiloDatabase.select({}, { data: other.data, channel: "latest" })
  expect(await Bun.file(fresh).exists()).toBe(false)
  expect(await strays(other.data)).toEqual([])
})

test("an earlier kilo2 build with sessions wins over the v1 store, and the v1 store over an empty earlier file", async () => {
  const { dir, data } = await root()
  await v1Store(KiloDatabase.v1Store(data), path.join(dir, "work"))
  const empty = new SQLite(path.join(data, "opencode.db"))
  empty.run("CREATE TABLE marker (id TEXT)")
  empty.close()
  read(await KiloDatabase.select({}, { data, channel: "latest" }), (db) =>
    expect(db.query("SELECT count(*) AS n FROM session_v2").get()).toEqual({ n: 2 }),
  )

  const branch = new SQLite(path.join(data, "opencode-branch.db"))
  branch.run("CREATE TABLE session_v2 (id TEXT)")
  branch.run("INSERT INTO session_v2 VALUES ('ses_kilo2')")
  branch.close()
  read(await KiloDatabase.select({}, { data, channel: "v2" }), (db) =>
    expect(db.query("SELECT id FROM session_v2").all()).toEqual([{ id: "ses_kilo2" }]),
  )
})

test("after the release renames the data directory to kilo, the same step converts kilo.db beside the new store", async () => {
  const { dir } = await root()
  const data = path.join(dir, "kilo")
  await v1Store(path.join(data, "kilo.db"), path.join(dir, "work"))
  expect(KiloDatabase.v1Store(data)).toBe(path.join(data, "kilo.db"))
  const file = await KiloDatabase.select({}, { data, channel: "latest" })
  expect(file).toBe(path.join(data, "kilo2.db"))
  read(file, (db) => expect(db.query("SELECT count(*) AS n FROM session_v2").get()).toEqual({ n: 2 }))
})
