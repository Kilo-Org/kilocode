import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { preflight } from "../src/migration/preflight"

function profile(root: string) {
  const home = path.join(root, "home")
  return {
    HOME: home,
    USERPROFILE: home,
    KILO_TEST_HOME: home,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
}

function snapshot(root: string) {
  return [".", ...readdirSync(root, { recursive: true, encoding: "utf8" }).sort()].map((name) => {
    const file = path.join(root, name)
    const stat = statSync(file, { bigint: true })
    return [
      name,
      stat.mtimeNs,
      stat.isDirectory() ? "dir" : createHash("sha256").update(readFileSync(file)).digest("hex"),
    ]
  })
}

function store(file: string, scratch: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  const writer = path.join(scratch, "writer.db")
  using db = new Database(writer)
  db.exec(readFileSync(path.join(import.meta.dir, "fixture", "kilo-v1-schema.sql"), "utf8"))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', '/', 1, 1, '[]');
    INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
      VALUES ('ses_preflight', 'global', 'fixture', '/', 'Uncheckpointed session', '7.0.0', 1, 1);
  `)
  // Preserve committed WAL pages but no shared-memory index: even a transient SQLite open can leave traces here.
  copyFileSync(writer, file)
  copyFileSync(`${writer}-wal`, `${file}-wal`)
}

function preview(file: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  using db = new Database(file)
  db.exec("CREATE TABLE session_v2 (id TEXT PRIMARY KEY); INSERT INTO session_v2 VALUES ('ses_preview')")
}

async function isolatedRun(root: string, ...args: string[]) {
  const temp = path.join(root, "tmp")
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../../../script/dev-isolated.ts"), ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ...profile(root),
      KILO_V2_PROFILE: root,
      KILO_INTERNAL_PROFILE_CUTOVER: "1",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      TMPDIR: temp,
      TEMP: temp,
      TMP: temp,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, stdout, stderr }
}

test("a resource-only profile blocks startup and preflight without changing v1 or an existing preview", async () => {
  await using root = await tmpdir()
  const env = profile(root.path)
  for (const dir of [...new Set(Object.values(env)), path.join(root.path, "tmp"), path.join(root.path, ".git")])
    mkdirSync(dir, { recursive: true })
  const auth = path.join(env.XDG_DATA_HOME, "kilo/auth.json")
  const skill = path.join(env.XDG_CONFIG_HOME, "kilo/skills/fixture")
  mkdirSync(path.dirname(auth), { recursive: true })
  mkdirSync(skill, { recursive: true })
  writeFileSync(auth, JSON.stringify({ fixture: { type: "api", key: "synthetic-only-api-key" } }), { mode: 0o600 })
  writeFileSync(path.join(skill, "SKILL.md"), "---\ndescription: Fixture skill\n---\nSynthetic private skill text")
  preview(path.join(env.XDG_DATA_HOME, "kilo2/kilo2.db"))
  const before = snapshot(root.path)
  for (const args of [
    ["migrate", "preflight"],
    ["debug", "paths"],
    ["migrate", "apply", "--accept-jetbrains-breakage"],
  ]) {
    const result = await isolatedRun(root.path, ...args)
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(auth)
    expect(result.stderr).toContain(skill)
    expect(result.stderr + result.stdout).not.toMatch(/synthetic-only-api-key|Synthetic private skill text/)
    expect(snapshot(root.path)).toEqual(before)
  }
})

test("an absent source reports zero bytes without creating even the XDG directories", async () => {
  await using root = await tmpdir()
  mkdirSync(path.join(root.path, ".git"))
  const env = profile(root.path)
  const before = snapshot(root.path)
  const result = preflight(env, root.path)
  expect(result).toMatchObject({
    version: 1,
    status: "absent",
    source: path.join(env.XDG_DATA_HOME, "kilo", "kilo.db"),
    sourceBytes: 0,
    walBytes: 0,
    previewStores: [],
  })
  expect(result.availableBytes).toBeGreaterThan(0)
  expect(snapshot(root.path)).toEqual(before)
})

test("explicit source and preview paths are inventoried alongside all preview channels without adopting them", async () => {
  await using root = await tmpdir()
  mkdirSync(path.join(root.path, ".git"))
  const env = profile(root.path)
  const source = path.join(env.XDG_DATA_HOME, "kilo", "branches", "custom.db")
  store(source, root.path)
  const data = path.join(env.XDG_DATA_HOME, "kilo2")
  const extra = path.join(root.path, "external.db")
  const stores = [
    path.join(data, "kilo2.db"),
    path.join(data, "kilo2-local.db"),
    path.join(data, "kilo2preview.db"),
    extra,
  ]
  for (const file of [...stores, path.join(data, "unrelated.db")]) preview(file)
  const before = snapshot(root.path)
  for (const override of [path.join("branches", "custom.db"), source]) {
    const result = preflight({ ...env, KILO_DB: override, KILO2_DB: extra })
    expect(result).toMatchObject({
      version: 1,
      status: "required",
      source,
      sourceBytes: statSync(source).size,
      walBytes: statSync(`${source}-wal`).size,
    })
    expect(result.walBytes).toBeGreaterThan(0)
    expect(result.previewStores.toSorted()).toEqual(stores.toSorted())
    expect(result.availableBytes).toBeGreaterThan(0)
    expect(result.backup.startsWith(root.path + path.sep)).toBe(true)
    expect(result.backup).not.toBe(source)
    expect(existsSync(result.backup)).toBe(false)
    expect(snapshot(root.path)).toEqual(before)
  }
  expect(preflight(env, root.path)).toMatchObject({ status: "absent", sourceBytes: 0, walBytes: 0 })
  expect(snapshot(root.path)).toEqual(before)
})

test.each(["kilo-feature.rc-1.db", "opencode-feature.rc-1.db"])(
  "a lone v1 channel store %s is selected with its committed WAL",
  async (name) => {
    await using root = await tmpdir()
    const env = profile(root.path)
    const source = path.join(env.XDG_DATA_HOME, "kilo", name)
    store(source, root.path)
    const before = snapshot(root.path)
    const plan = preflight(env)
    expect(plan).toMatchObject({
      status: "required",
      source,
      sourceBytes: statSync(source).size,
      backup: `${source}.pre-v2`,
    })
    expect(plan.walBytes).toBeGreaterThan(0)
    expect(snapshot(root.path)).toEqual(before)
  },
)

test("mixed v1 stores report every current and fallback path, even with an explicit selection", async () => {
  await using root = await tmpdir()
  const env = profile(root.path)
  const data = path.join(env.XDG_DATA_HOME, "kilo")
  mkdirSync(data, { recursive: true })
  const files = ["kilo.db", "kilo-nightly.db", "opencode-nightly.db", "opencode-old.db"].map((name) =>
    path.join(data, name),
  )
  for (const file of files) {
    using db = new Database(file)
    db.exec("CREATE TABLE session (id TEXT PRIMARY KEY)")
    db.run("INSERT INTO session VALUES (?)", [path.basename(file)])
  }
  const before = snapshot(root.path)
  const paths = files.toSorted().join("\n")
  expect(() => preflight(env)).toThrow(paths)
  expect(() => preflight({ ...env, KILO_DB: "kilo-nightly.db" })).toThrow(paths)
  expect(snapshot(root.path)).toEqual(before)
})

test("the client can preflight then decline a real store without initializing a profile or touching any file", async () => {
  await using root = await tmpdir()
  const env = profile(root.path)
  const temp = path.join(root.path, "tmp")
  // bun dev supplies these six root directories to the host. No kilo2 app directories exist yet.
  for (const dir of [...new Set(Object.values(env)), temp]) mkdirSync(dir, { recursive: true })
  const source = path.join(env.XDG_DATA_HOME, "kilo", "kilo.db")
  store(source, root.path)
  mkdirSync(path.join(env.XDG_CONFIG_HOME, "kilo"))
  writeFileSync(path.join(env.XDG_CONFIG_HOME, "kilo", "kilo.json"), '{"model":"kilo/test"}')
  const before = snapshot(root.path)

  async function run(action: "preflight" | "decline") {
    const wrapper = path.join(import.meta.dir, "../../../script/dev-isolated.ts")
    const child = Bun.spawn([process.execPath, wrapper, "migrate", action], {
      cwd: root.path,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|WINDIR|PATHEXT)$/i.test(key)),
        ),
        ...env,
        KILO_V2_PROFILE: root.path,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        TMPDIR: temp,
        TEMP: temp,
        TMP: temp,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(code, stderr).toBe(0)
    return JSON.parse(stdout)
  }
  expect(await run("preflight")).toMatchObject({
    version: 1,
    status: "required",
    source,
    sourceBytes: statSync(source).size,
    walBytes: statSync(`${source}-wal`).size,
    previewStores: [],
    availableBytes: expect.any(Number),
    backup: expect.any(String),
  })
  expect(snapshot(root.path)).toEqual(before)
  expect(await run("decline")).toMatchObject({ status: "declined" })
  expect(snapshot(root.path)).toEqual(before)
})
