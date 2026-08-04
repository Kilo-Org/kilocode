import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { accessSync, chmodSync, constants } from "fs"
import path from "path"
import { DbPreflight } from "@opencode-ai/core/kilocode/db-preflight"
import { Database as KiloDatabase } from "@opencode-ai/core/database/database"
import { tmpdir } from "../fixture/tmpdir"

const writable = (file: string) => {
  try {
    accessSync(file, constants.W_OK)
    return true
  } catch {
    return false
  }
}

// Windows: chmod is a no-op, so non-writable files cannot be staged; root ignores permission bits
const skip = process.platform === "win32" || process.getuid?.() === 0

function createWalDb(file: string) {
  const db = new Database(file)
  db.run("PRAGMA journal_mode = WAL")
  db.run("CREATE TABLE t (x)")
  db.run("INSERT INTO t VALUES (1)")
  db.close()
}

// leaves committed-but-uncheckpointed frames in the WAL by SIGKILLing the writer,
// reproducing the state a crashed kilo process leaves behind
async function createWalDbWithPendingFrames(file: string) {
  const script = [
    `const { Database } = require("bun:sqlite")`,
    `const db = new Database(${JSON.stringify(file)})`,
    `db.run("PRAGMA journal_mode = WAL")`,
    `db.run("PRAGMA wal_autocheckpoint = 0")`,
    `db.run("CREATE TABLE t (x)")`,
    `db.run("INSERT INTO t VALUES (1)")`,
    `console.log("ready")`,
    `setInterval(() => {}, 1000)`,
  ].join("\n")
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe" })
  const reader = child.stdout.getReader()
  await reader.read()
  child.kill("SIGKILL")
  await child.exited
}

describe("DbPreflight", () => {
  test("skips in-memory databases", () => {
    expect(() => DbPreflight.assertWritable(":memory:")).not.toThrow()
  })

  test("accepts a writable database", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "kilo.db")
    createWalDb(file)
    expect(() => DbPreflight.assertWritable(file)).not.toThrow()
  })

  test("names the offending file for a read-only sidecar outside the kilo data dir", async () => {
    if (skip) return
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "kilo.db")
    // a clean close deletes the sidecars on some platforms; a killed writer always leaves them
    await createWalDbWithPendingFrames(file)
    chmodSync(`${file}-wal`, 0o444)
    expect(() => DbPreflight.assertWritable(file)).toThrow(`Database file is not writable: ${file}-wal`)
    chmodSync(`${file}-wal`, 0o644)
  })

  test("repairs read-only files inside the trusted dir", async () => {
    if (skip) return
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "kilo.db")
    await createWalDbWithPendingFrames(file)
    chmodSync(file, 0o444)
    chmodSync(`${file}-wal`, 0o444)
    expect(() => DbPreflight.assertWritable(file, tmp.path)).not.toThrow()
    expect(writable(file)).toBe(true)
    expect(writable(`${file}-wal`)).toBe(true)
  })

  test("reports a missing directory as missing, not as read-only", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "absent")
    const file = path.join(dir, "kilo.db")
    expect(() => DbPreflight.assertWritable(file)).toThrow(`Database directory does not exist: ${dir}`)
  })

  test("rejects a read-only directory when WAL files must be created", async () => {
    if (skip) return
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "locked")
    const file = path.join(dir, "kilo.db")
    await Bun.write(path.join(dir, ".keep"), "")
    chmodSync(dir, 0o555)
    try {
      expect(() => DbPreflight.assertWritable(file)).toThrow(`Database directory is not writable: ${dir}`)
    } finally {
      chmodSync(dir, 0o755)
    }
  })

  test("pending WAL frames with a read-only sidecar fail with the actionable error, and repair recovers the data", async () => {
    if (skip) return
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "kilo.db")
    await createWalDbWithPendingFrames(file)
    chmodSync(`${file}-wal`, 0o444)

    // without repair (untrusted dir) the wiring in layerFromPath surfaces the clear error
    expect(() => KiloDatabase.layerFromPath(file)).toThrow(`Database file is not writable: ${file}-wal`)

    // with repair the startup pragma sequence succeeds and the committed row survives
    DbPreflight.assertWritable(file, tmp.path)
    const db = new Database(file, { readwrite: true, create: true })
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA wal_checkpoint(PASSIVE)")
    expect(db.query("SELECT x FROM t").all()).toEqual([{ x: 1 }])
    db.close()
  })
})
