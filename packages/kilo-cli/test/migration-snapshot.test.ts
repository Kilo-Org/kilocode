import { Database } from "bun:sqlite"
import { afterEach, expect, spyOn, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { snapshot } from "../src/migration/snapshot"

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-snapshot-test-"))
  roots.push(root)
  const dir = path.join(root, "recovery")
  fs.mkdirSync(dir)
  const source = path.join(root, "sessions.db")
  const backup = path.join(dir, "backup.db")
  using db = new Database(source)
  db.run("CREATE TABLE note(id INTEGER PRIMARY KEY, body TEXT)")
  db.run("INSERT INTO note VALUES(10, 'committed')")
  return { root, source, dir, backup }
}

test("recovery is private, standalone, and unaffected by later source writes", async () => {
  const { source, backup, dir } = fixture()
  const bytes = fs.readFileSync(source)
  const mode = fs.statSync(source).mode
  await snapshot(source, backup)
  expect(fs.readdirSync(dir)).toEqual(["backup.db"])
  expect(fs.readFileSync(source)).toEqual(bytes)
  expect(fs.statSync(source).mode).toBe(mode)
  if (process.platform !== "win32") expect(fs.statSync(backup).mode & 0o777).toBe(0o600)
  using current = new Database(source)
  current.run("DELETE FROM note")
  using db = new Database(backup, { readonly: true })
  expect(db.query("SELECT * FROM note").all()).toEqual([{ id: 10, body: "committed" }])
})

test("recovery includes committed WAL frames without checkpointing the source", async () => {
  const { source, root, backup, dir } = fixture()
  // Model the files left after an unclean WAL shutdown: the database and WAL survive, but there is no live index.
  const offline = path.join(root, "offline.db")
  {
    using db = new Database(source)
    db.run("PRAGMA journal_mode=WAL")
    db.run("PRAGMA wal_autocheckpoint=0")
    db.run("INSERT INTO note VALUES(20, 'only in WAL')")
    fs.copyFileSync(source, offline)
    fs.copyFileSync(`${source}-wal`, `${offline}-wal`)
  }
  const main = fs.readFileSync(offline)
  const wal = fs.readFileSync(`${offline}-wal`)
  const phases: string[] = []
  await snapshot(offline, backup, (phase) => phases.push(phase))
  expect(phases).toContain("Copying recovery database with SQLite")
  expect(fs.readFileSync(offline)).toEqual(main)
  expect(fs.readFileSync(`${offline}-wal`)).toEqual(wal)
  expect(fs.readdirSync(dir)).toEqual(["backup.db"])
  using restored = new Database(backup, { readonly: true })
  expect(restored.query("SELECT body FROM note ORDER BY id").all()).toEqual([
    { body: "committed" },
    { body: "only in WAL" },
  ])
})

test("a closed WAL-mode store with no sidecars remains recoverable", async () => {
  const { source, root, backup } = fixture()
  {
    using db = new Database(source)
    db.run("PRAGMA journal_mode=WAL")
    db.run("INSERT INTO note VALUES(20, 'checkpointed')")
    db.query("PRAGMA wal_checkpoint(TRUNCATE)").get()
  }
  const clean = path.join(root, "closed.db")
  fs.copyFileSync(source, clean)
  const bytes = fs.readFileSync(clean)
  await snapshot(clean, backup)
  expect(fs.readFileSync(clean)).toEqual(bytes)
  using copy = new Database(backup, { readonly: true })
  expect(copy.query("SELECT body FROM note WHERE id=20").get()).toEqual({ body: "checkpointed" })
})

test.each(["DELETE", "WAL"])("a %s writer with no changed pages still blocks snapshot", async (mode) => {
  const { source, backup, dir } = fixture()
  using writer = new Database(source)
  writer.run(`PRAGMA journal_mode=${mode}`)
  writer.run("BEGIN IMMEDIATE")
  await expect(snapshot(source, backup)).rejects.toThrow(/SQLite client is using/)
  expect(fs.readdirSync(dir)).toEqual([])
  writer.run("INSERT INTO note VALUES(11, 'writer still owns the transaction')")
  writer.run("COMMIT")
})

test("a forced clone rejected by the volume falls back to a SQLite copy", async () => {
  const { source, backup } = fixture()
  const clone = spyOn(fs, "copyFileSync").mockImplementationOnce(() => {
    throw Object.assign(new Error("no clone on this volume"), { code: "EXDEV" })
  })
  try {
    const phases: string[] = []
    await snapshot(source, backup, (phase) => phases.push(phase))
    expect(phases).toContain("Copying recovery database with SQLite")
    expect(clone.mock.calls[0]?.[2]).toBe(fs.constants.COPYFILE_FICLONE_FORCE | fs.constants.COPYFILE_EXCL)
    using copy = new Database(backup, { readonly: true })
    expect(copy.query("SELECT id FROM note").all()).toEqual([{ id: 10 }])
  } finally {
    clone.mockRestore()
  }
})

test("insufficient space on the backup volume leaves no partial file", async () => {
  const { source, backup, dir } = fixture()
  const before = fs.readFileSync(source)
  const full = { ...fs.statfsSync(dir, { bigint: true }), bavail: 0n }
  const probe = spyOn(fs, "statfsSync").mockReturnValueOnce(full)
  try {
    await expect(snapshot(source, backup)).rejects.toThrow(/Insufficient space/)
    // Match the native path used for staging (Windows TEMP may use an 8.3 alias).
    expect(path.dirname(String(probe.mock.calls[0]?.[0]))).toBe(fs.realpathSync.native(dir))
    expect(fs.readdirSync(dir)).toEqual([])
    expect(fs.readFileSync(source)).toEqual(before)
  } finally {
    probe.mockRestore()
  }
})

test("refuses occupied names, source aliases and recovery sidecars", async () => {
  const { source, backup, dir } = fixture()
  const before = fs.readFileSync(source)
  fs.writeFileSync(backup, "other recovery file")
  await expect(snapshot(source, backup)).rejects.toThrow(/exists/)
  expect(fs.readFileSync(backup, "utf8")).toBe("other recovery file")
  await expect(snapshot(source, source)).rejects.toThrow(/overlaps/)
  await expect(snapshot(source, `${source}-wal`)).rejects.toThrow(/overlaps/)
  fs.rmSync(backup)
  fs.writeFileSync(`${backup}-journal`, "orphaned journal")
  await expect(snapshot(source, backup)).rejects.toThrow(/exists/)
  expect(fs.readFileSync(source)).toEqual(before)
  expect(fs.readdirSync(dir)).toEqual(["backup.db-journal"])
})

test("verification rejects a damaged candidate before the backup name is published", async () => {
  const { source, backup, dir } = fixture()
  await expect(
    snapshot(source, backup, (phase) => {
      if (phase !== "Verifying recovery database") return
      expect(fs.existsSync(backup)).toBe(false)
      const scratch = path.join(dir, fs.readdirSync(dir)[0]!)
      if (process.platform !== "win32") expect(fs.statSync(scratch).mode & 0o777).toBe(0o700)
      fs.writeFileSync(path.join(scratch, "recovery.db"), "not a database")
    }),
  ).rejects.toThrow(/database/)
  expect(fs.readdirSync(dir)).toEqual([])
})

test("a competing destination appearing during capture is never replaced", async () => {
  const { source, backup, dir } = fixture()
  await expect(
    snapshot(source, backup, (phase) => {
      if (phase === "Verifying recovery database") fs.writeFileSync(backup, "already published", { flag: "wx" })
    }),
  ).rejects.toThrow(/already exists/)
  expect(fs.readFileSync(backup, "utf8")).toBe("already published")
  expect(fs.readdirSync(dir)).toEqual(["backup.db"])
})
