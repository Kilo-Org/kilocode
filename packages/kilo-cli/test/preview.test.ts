import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { cp, link, mkdir, rm, symlink } from "node:fs/promises"
import path from "node:path"
import { entry, fixture, run, type Fixture } from "./fixture"

async function stable(input: Fixture) {
  const directory = path.join(input.env.XDG_DATA_HOME, "kilo")
  await mkdir(directory, { recursive: true })
  const filename = path.join(directory, "kilo.db")
  using db = new Database(filename)
  db.run("CREATE TABLE session (id TEXT PRIMARY KEY)")
  db.run("INSERT INTO session VALUES ('keep-me')")
  return filename
}

async function unchanged(filename: string, before: Uint8Array<ArrayBuffer>) {
  expect(new Uint8Array(await Bun.file(filename).arrayBuffer())).toEqual(before)
  expect(await Bun.file(`${filename}-wal`).exists()).toBe(false)
  expect(await Bun.file(`${filename}-shm`).exists()).toBe(false)
}

test("help, version and path inspection never acquire storage", async () => {
  await using input = await fixture()
  for (const args of [[], ["--help"], ["--version"], ["paths"]]) {
    const result = await run(input, args)
    expect(result.code, result.stderr).toBe(0)
  }
  expect(await Bun.file(input.layout.database).exists()).toBe(false)
  expect(existsSync(input.env.XDG_DATA_HOME)).toBe(false)
  expect(input.layout.database).toBe(path.join(input.env.XDG_DATA_HOME, "kilo2", "preview", "kilo2.db"))
})

test("initializes and reopens an owned empty store, ignoring upstream and stable overrides", async () => {
  await using input = await fixture()
  const original = await stable(input)
  const before = new Uint8Array(await Bun.file(original).arrayBuffer())
  const config = path.join(input.env.XDG_CONFIG_HOME, "kilo", "kilo.jsonc")
  await Bun.write(config, '{"model":"never-read-this-config"}')
  const poisoned = {
    ...input,
    env: {
      ...input.env,
      KILO_DB: original,
      OPENCODE_DB: original,
      KILO_CONFIG_DIR: path.dirname(config),
      OPENCODE_CONFIG_DIR: path.dirname(config),
      OPENCODE_CONFIG: config,
      OPENCODE_CONFIG_CONTENT: "{ invalid JSON",
      OPENCODE_TEST_HOME: path.dirname(original),
    },
  }
  for (const command of ["init", "init"]) {
    const result = await run(poisoned, [command])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain("Kilo internal preview: initialized")
  }
  using db = new Database(input.layout.database, { readonly: true })
  expect(db.query("SELECT name FROM sqlite_master WHERE name = 'session'").get()).toBeNull()
  expect(db.query("SELECT COUNT(*) AS count FROM session_v2").get()).toEqual({ count: 0 })
  expect(db.query("SELECT COUNT(*) AS count FROM credential").get()).toEqual({ count: 0 })
  expect(db.query("SELECT application, channel FROM _kilo_preview").get()).toEqual({
    application: "kilo2",
    channel: "preview",
  })
  await unchanged(original, before)
  expect(await Bun.file(config).text()).toBe('{"model":"never-read-this-config"}')
})

for (const kind of ["directory", "database", "hardlink", "config"] as const) {
  test(`rejects a protected ${kind} alias before changing stable storage`, async () => {
    await using input = await fixture()
    const original = await stable(input)
    const before = new Uint8Array(await Bun.file(original).arrayBuffer())
    if (kind === "directory") {
      await symlink(path.dirname(original), path.dirname(input.layout.paths.data), "dir")
    }
    if (kind === "database" || kind === "hardlink") {
      await mkdir(input.layout.paths.data, { recursive: true })
      if (kind === "database") await symlink(original, input.layout.database)
      if (kind === "hardlink") await link(original, input.layout.database)
    }
    if (kind === "config") {
      await mkdir(input.layout.paths.config, { recursive: true })
      await symlink(original, input.layout.config)
    }
    const result = await run(input, ["init"])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Refusing")
    expect(result.stdout).not.toContain("initialized")
    await unchanged(original, before)
  })
}

for (const table of ["session", "session_v2"]) {
  test(`rejects an unowned ${table} store without running migrations`, async () => {
    await using input = await fixture()
    await mkdir(input.layout.paths.data, { recursive: true })
    {
      using db = new Database(input.layout.database)
      db.run(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`)
      db.run(`INSERT INTO ${table} VALUES ('preserve')`)
    }
    const before = new Uint8Array(await Bun.file(input.layout.database).arrayBuffer())
    const result = await run(input, ["init"])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Refusing")
    await unchanged(input.layout.database, before)
  })
}

for (const name of ["auth.json", "opencode-next.db"]) {
  test(`rejects ambient legacy import source ${name}`, async () => {
    await using input = await fixture()
    await Bun.write(path.join(input.layout.paths.data, name), "preserve legacy data")
    const result = await run(input, ["init"])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("automatic import is disabled")
    expect(await Bun.file(input.layout.database).exists()).toBe(false)
  })
}

async function removeCheckpointedSidecars(filename: string) {
  const wal = Bun.file(`${filename}-wal`)
  if (await wal.exists()) expect((await wal.stat()).size).toBe(0)
  await Promise.all(["-wal", "-shm"].map((suffix) => rm(filename + suffix, { force: true })))
}

test("rejects an unowned WAL database without creating SQLite sidecars", async () => {
  await using input = await fixture()
  await mkdir(input.layout.paths.data, { recursive: true })
  {
    using db = new Database(input.layout.database)
    db.run("PRAGMA journal_mode = WAL")
    db.run("CREATE TABLE session_v2 (id TEXT PRIMARY KEY)")
    db.run("INSERT INTO session_v2 VALUES ('preserve')")
    db.run("PRAGMA wal_checkpoint(TRUNCATE)")
  }
  await removeCheckpointedSidecars(input.layout.database)
  const before = new Uint8Array(await Bun.file(input.layout.database).arrayBuffer())
  await unchanged(input.layout.database, before)
  const result = await run(input, ["init"])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("unrecognized database")
  await unchanged(input.layout.database, before)
})

test("rejects an owned store with pending WAL data without modifying it", async () => {
  await using input = await fixture()
  const initialized = await run(input, ["init"])
  expect(initialized.code, initialized.stderr).toBe(0)
  using db = new Database(input.layout.database)
  db.run("PRAGMA journal_mode = WAL")
  db.run("CREATE TABLE _pending (id INTEGER)")
  const wal = await Bun.file(`${input.layout.database}-wal`).arrayBuffer()
  const shm = await Bun.file(`${input.layout.database}-shm`).arrayBuffer()
  const result = await run(input, ["init"])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("pending journal data")
  expect(await Bun.file(`${input.layout.database}-wal`).arrayBuffer()).toEqual(wal)
  expect(await Bun.file(`${input.layout.database}-shm`).arrayBuffer()).toEqual(shm)
})

test("rejects owned sessions before the SDK can resume their execution", async () => {
  await using input = await fixture()
  const initialized = await run(input, ["init"])
  expect(initialized.code, initialized.stderr).toBe(0)
  {
    using db = new Database(input.layout.database)
    db.query(
      "INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', ?, 1, 1, '[]')",
    ).run(input.cwd)
    db.query(
      "INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated, time_suspended, resume_attempts) VALUES ('ses_phase0', 'global', 'phase0', ?, 'Preserve', '1', 1, 1, 1, 2)",
    ).run(input.cwd)
    db.run("PRAGMA wal_checkpoint(TRUNCATE)")
  }
  await removeCheckpointedSidecars(input.layout.database)
  const before = new Uint8Array(await Bun.file(input.layout.database).arrayBuffer())
  const result = await run(input, ["init"])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("populated session store")
  await unchanged(input.layout.database, before)
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`preview shuts down cleanly on ${signal}`, async () => {
    await using input = await fixture()
    const child = Bun.spawn([process.execPath, "--no-env-file", entry, "preview"], {
      cwd: input.cwd,
      env: input.env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: 15_000,
    })
    const errors = new Response(child.stderr).text()
    const reader = child.stdout.getReader()
    const chunks: string[] = []
    const decoder = new TextDecoder()
    try {
      while (!chunks.join("").includes("Kilo internal preview: ready")) {
        const value = await reader.read()
        if (value.done) throw new Error(`Preview exited before readiness: ${await errors}`)
        chunks.push(decoder.decode(value.value, { stream: true }))
      }
      child.kill(signal)
      expect(await child.exited, await errors).toBe(0)
      const reopened = await run(input, ["init"])
      expect(reopened.code, reopened.stderr).toBe(0)
    } finally {
      reader.releaseLock()
      child.kill("SIGTERM")
      await child.exited
    }
  })
}

test("packaged help and fresh boot work outside the repository without loading dotenv", async () => {
  await using input = await fixture()
  const artifact = path.join(input.directory, "artifact")
  await cp(process.env.KILO_CLI_TEST_ARTIFACT_DIR ?? path.resolve(import.meta.dir, "../dist"), artifact, {
    recursive: true,
  })
  const binary = path.join(artifact, process.platform === "win32" ? "kilo2.exe" : "kilo2")
  await Bun.write(path.join(input.cwd, ".env"), `XDG_DATA_HOME=${path.join(input.directory, "poisoned")}\n`)
  const help = await run(input, ["--help"], binary)
  expect(help.code, help.stderr).toBe(0)
  expect(help.stdout).toContain("Kilo internal preview")
  const result = await run(input, ["init"], binary)
  expect(result.code, result.stderr).toBe(0)
  expect(await Bun.file(input.layout.database).exists()).toBe(true)
  expect(existsSync(path.join(input.directory, "poisoned"))).toBe(false)
})
