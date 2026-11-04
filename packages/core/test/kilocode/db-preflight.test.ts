import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { accessSync, chmodSync, constants } from "node:fs"
import path from "node:path"
import { DbPreflight } from "@opencode/core/kilocode/db-preflight"
import { tmpdir } from "../fixture/tmpdir"

const writable = (file: string) => {
  try {
    accessSync(file, constants.W_OK)
    return true
  } catch {
    return false
  }
}

// Windows: chmod is a no-op, so non-writable files cannot be staged; root ignores permission bits.
const skip = process.platform === "win32" || process.getuid?.() === 0

function createWalDb(file: string) {
  const db = new Database(file)
  db.run("PRAGMA journal_mode = WAL")
  db.run("CREATE TABLE t (x)")
  db.run("INSERT INTO t VALUES (1)")
  db.close()
}

// Leaves committed-but-uncheckpointed frames in the WAL by SIGKILLing the writer, reproducing the
// state a crashed Kilo process leaves behind.
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

describe("DbPreflight.assertWritable", () => {
  test("skips in-memory databases", () => {
    expect(() => DbPreflight.assertWritable(":memory:")).not.toThrow()
  })

  test("accepts a writable database", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "kilo.db")
    createWalDb(file)
    expect(() => DbPreflight.assertWritable(file)).not.toThrow()
  })

  test.skipIf(skip)("names the offending file for a read-only sidecar outside the trusted dir", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "kilo.db")
    // A clean close deletes the sidecars on some platforms; a killed writer always leaves them.
    await createWalDbWithPendingFrames(file)
    chmodSync(`${file}-wal`, 0o444)
    expect(() => DbPreflight.assertWritable(file)).toThrow(`Database file is not writable: ${file}-wal`)
    chmodSync(`${file}-wal`, 0o644)
  })

  test.skipIf(skip)("repairs read-only files inside the trusted dir", async () => {
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

  test.skipIf(skip)("rejects a read-only directory when WAL files must be created", async () => {
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

  test.skipIf(skip)("repair recovers pending WAL frames after a read-only sidecar", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "kilo.db")
    await createWalDbWithPendingFrames(file)
    chmodSync(`${file}-wal`, 0o444)
    // Repair (trusted dir) then the startup pragma sequence succeeds and the committed row survives.
    DbPreflight.assertWritable(file, tmp.path)
    const db = new Database(file, { readwrite: true, create: true })
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA wal_checkpoint(PASSIVE)")
    expect(db.query("SELECT x FROM t").all()).toEqual([{ x: 1 }])
    db.close()
  })
})
