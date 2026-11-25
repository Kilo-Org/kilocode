import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
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

test("stable resource-only profiles can start; unresolved v1 workflows stop without touching the profile", async () => {
  await using root = await tmpdir()
  const env = profile(root.path)
  mkdirSync(path.join(root.path, ".git"))
  const config = path.join(env.XDG_CONFIG_HOME, "kilo")
  mkdirSync(config, { recursive: true })
  writeFileSync(path.join(config, "kilo.json"), "{}")
  expect(preflight(env, root.path).status).toBe("absent")
  const wf = path.join(env.HOME, ".kilocode/workflows/legacy.md")
  mkdirSync(path.dirname(wf), { recursive: true })
  writeFileSync(wf, "private workflow")
  const before = snapshot(root.path)
  expect(() => preflight(env, root.path)).toThrow(wf)
  expect(snapshot(root.path)).toEqual(before)
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
  })
  expect(result.availableBytes).toBeGreaterThan(0)
  expect(snapshot(root.path)).toEqual(before)
})

test("relative and absolute KILO_DB select the same store without adopting sibling files", async () => {
  await using root = await tmpdir()
  const env = profile(root.path)
  const source = path.join(env.XDG_DATA_HOME, "kilo/branches/custom.db")
  store(source, root.path)
  const before = snapshot(root.path)
  for (const selected of [source, "branches/custom.db"])
    expect(preflight({ ...env, KILO_DB: selected })).toMatchObject({
      status: "required",
      source,
      walBytes: statSync(source + "-wal").size,
    })
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

test("ambiguous channels require selection; the canonical store and explicit selectors are authoritative", async () => {
  await using root = await tmpdir()
  const env = profile(root.path)
  const data = path.join(env.XDG_DATA_HOME, "kilo")
  mkdirSync(data, { recursive: true })
  const files = ["kilo-nightly.db", "opencode-nightly.db", "opencode-old.db"].map((name) => path.join(data, name))
  for (const file of files) {
    using db = new Database(file)
    db.exec("CREATE TABLE session (id TEXT PRIMARY KEY)")
    db.run("INSERT INTO session VALUES (?)", [path.basename(file)])
  }
  const before = snapshot(root.path)
  const paths = files.toSorted().join("\n")
  expect(() => preflight(env)).toThrow(paths)
  expect(preflight({ ...env, KILO_DB: "kilo-nightly.db" }).source).toBe(files[0]!)
  expect(snapshot(root.path)).toEqual(before)
  copyFileSync(files[0]!, path.join(data, "kilo.db"))
  expect(preflight(env).source).toBe(path.join(data, "kilo.db"))
})

test("the client can preflight then decline a real store without initializing a profile or touching any file", async () => {
  await using root = await tmpdir()
  const env = profile(root.path)
  const temp = path.join(root.path, "tmp")
  // bun dev supplies these six root directories to the host. The fixture supplies only its v1 input.
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
    availableBytes: expect.any(Number),
    backup: expect.any(String),
  })
  expect(snapshot(root.path)).toEqual(before)
  expect(await run("decline")).toMatchObject({ status: "declined" })
  expect(snapshot(root.path)).toEqual(before)
})
