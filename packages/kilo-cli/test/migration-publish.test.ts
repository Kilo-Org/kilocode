import { constants, Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { isolatedEnv } from "../../cli/test/fixture/environment"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { linkedOriginal, retryPublication, stageAndPublish } from "../src/migration/publish"
import { beginStage } from "../src/migration/stage-record"

// A cutover must not unlock and hope that a subsequent Windows rename succeeds. Unknown volumes also fail closed.
const canReplace =
  process.platform === "darwin"
    ? Bun.spawnSync(["/bin/df", "-t", "apfs", os.tmpdir()]).exitCode === 0
    : process.platform === "linux" &&
      ["ef53", "58465342", "9123683e"].includes((fs.statfsSync(os.tmpdir()).type >>> 0).toString(16))

function fixture(dir: string, mode = "DELETE") {
  const file = path.join(dir, "history.db")
  using db = new Database(file)
  db.exec(`PRAGMA journal_mode=${mode}; CREATE TABLE history(id INTEGER PRIMARY KEY); INSERT INTO history VALUES(11)`)
  return { file, backup: file + ".pre-v2" }
}

function read(file: string) {
  // Open the main file alone. Stale sidecars cannot make an incomplete backup appear valid.
  using db = new Database(
    `${pathToFileURL(file).href}?immutable=1`,
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI,
  )
  return db
    .query<{ id: number }, []>("SELECT id FROM history ORDER BY id")
    .all()
    .map((r) => r.id)
}

async function convert(stage: string) {
  using db = new Database(stage, { readwrite: true, create: false })
  db.exec("PRAGMA journal_mode=WAL; INSERT INTO history VALUES (22)")
}

const noop = () => {}

test.if(canReplace)(
  "replaces the canonical inode, preserves the original inode, and leaves no live sidecars",
  async () => {
    await using root = await tmpdir()
    const { file, backup } = fixture(root.path, "WAL")
    const inode = fs.statSync(file, { bigint: true }).ino
    await stageAndPublish(file, backup, convert, noop)
    expect(fs.statSync(backup, { bigint: true }).ino).toBe(inode)
    expect(fs.statSync(file, { bigint: true }).ino).not.toBe(inode)
    expect(read(file)).toEqual([11, 22])
    expect(read(backup)).toEqual([11])
    expect(fs.readdirSync(root.path).sort()).toEqual(["history.db", "history.db.pre-v2"])
  },
)

test.if(canReplace)("recovers committed frames from a crashed WAL client into both standalone databases", async () => {
  await using root = await tmpdir()
  const { file, backup } = fixture(root.path)
  const proc = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      `
    import { Database } from "bun:sqlite";
    const db = new Database(${JSON.stringify(file)});
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO history VALUES (19)");
    process.kill(process.pid, "SIGKILL");
  `,
    ],
    { cwd: root.path, env: isolatedEnv(root.path) },
  )
  expect(proc.stderr.toString()).toBe("")
  expect(fs.statSync(file + "-wal").size).toBeGreaterThan(0)
  expect(read(file)).toEqual([11])
  await stageAndPublish(file, backup, convert, noop)
  expect(read(backup)).toEqual([11, 19])
  expect(read(file)).toEqual([11, 19, 22])
})

test.if(canReplace)("discarding a partially converted stage does not change original history", async () => {
  await using root = await tmpdir()
  const { file, backup } = fixture(root.path)
  const bytes = fs.readFileSync(file)
  await expect(
    stageAndPublish(
      file,
      backup,
      async (stage) => {
        await convert(stage)
        throw new Error("fixture validation failed")
      },
      noop,
    ),
  ).rejects.toThrow("fixture validation failed")
  expect(fs.readFileSync(file)).toEqual(bytes)
  expect(fs.readdirSync(root.path)).toEqual(["history.db"])
})

for (const mode of ["DELETE", "WAL"]) {
  test.if(canReplace)(`rejects a newer ${mode} commit instead of losing a concurrently added row`, async () => {
    await using root = await tmpdir()
    const { file, backup } = fixture(root.path, mode)
    using client = new Database(file, { readwrite: true })
    await expect(
      stageAndPublish(
        file,
        backup,
        async (stage) => {
          await convert(stage)
          client.exec("INSERT INTO history VALUES (33)")
        },
        noop,
      ),
    ).rejects.toThrow("changed since staging")
    expect(client.query("SELECT id FROM history ORDER BY id").values()).toEqual([[11], [33]])
    expect(fs.existsSync(backup)).toBe(false)
  })

  for (const transaction of ["BEGIN; SELECT * FROM history", "BEGIN IMMEDIATE"]) {
    test.if(canReplace)(`rejects a client holding ${transaction} on the ${mode} source at publication`, async () => {
      await using root = await tmpdir()
      const { file, backup } = fixture(root.path, mode)
      const script = `
        import { Database } from "bun:sqlite";
        using db = new Database(${JSON.stringify(file)});
        for await (const _ of Bun.stdin.stream()) {
          db.exec(${JSON.stringify(transaction)});
          console.log("locked");
        }
      `
      const proc = Bun.spawn([process.execPath, "-e", script], {
        cwd: root.path,
        env: isolatedEnv(root.path),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
      try {
        await expect(
          stageAndPublish(
            file,
            backup,
            async (stage) => {
              await convert(stage)
              proc.stdin.write("start\n")
              await proc.stdin.flush()
              const ready = await proc.stdout.getReader().read()
              expect(new TextDecoder().decode(ready.value).trim()).toBe("locked")
            },
            noop,
          ),
        ).rejects.toThrow("Another SQLite client")
      } finally {
        proc.stdin.end()
        await proc.exited
      }
      expect(await new Response(proc.stderr).text()).toBe("")
      expect(read(file)).toEqual([11])
      expect(fs.existsSync(backup)).toBe(false)
    })
  }
}

test.if(canReplace)("never replaces a recovery file that appeared during conversion", async () => {
  await using root = await tmpdir()
  const { file, backup } = fixture(root.path)
  await expect(
    stageAndPublish(
      file,
      backup,
      async (stage) => {
        await convert(stage)
        fs.writeFileSync(backup, "prior recovery")
      },
      noop,
    ),
  ).rejects.toThrow("Recovery file already exists")
  expect(fs.readFileSync(backup, "utf8")).toBe("prior recovery")
  expect(read(file)).toEqual([11])
})

test.if(canReplace)("rejects aliases and an untrusted output directory before staging", async () => {
  await using root = await tmpdir()
  const { file, backup } = fixture(root.path)
  const alias = file + ".alias"
  fs.symlinkSync(file, alias)
  await expect(stageAndPublish(alias, backup, convert, noop)).rejects.toThrow("unaliased regular file")
  fs.unlinkSync(alias)
  fs.linkSync(file, alias)
  await expect(stageAndPublish(file, backup, convert, noop)).rejects.toThrow("unaliased regular file")
  fs.unlinkSync(alias)
  fs.chmodSync(root.path, 0o777)
  await expect(stageAndPublish(file, backup, convert, noop)).rejects.toThrow("Untrusted database directory")
  expect(read(file)).toEqual([11])
  expect(fs.existsSync(backup)).toBe(false)
})

test.if(!canReplace)("refuses a non-supported platform/volume without touching the original", async () => {
  await using root = await tmpdir()
  const { file, backup } = fixture(root.path)
  const bytes = fs.readFileSync(file)
  await expect(stageAndPublish(file, backup, convert, noop)).rejects.toThrow("Safe database replacement requires local")
  expect(fs.readFileSync(file)).toEqual(bytes)
  expect(fs.existsSync(backup)).toBe(false)
})

test("linkedOriginal returns false when the source database is missing", async () => {
  await using root = await tmpdir()
  const { file, backup } = fixture(root.path)
  fs.renameSync(file, backup)
  expect(linkedOriginal(file, backup)).toBe(false)
})

test.if(canReplace)("retryPublication clears an empty source WAL and SHM but refuses a non-empty WAL", async () => {
  await using root = await tmpdir()
  const { file, backup } = fixture(root.path)
  {
    using db = new Database(file, { readwrite: true })
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE")
  }
  fs.chmodSync(file, 0o600)
  const scratch = fs.mkdtempSync(path.join(root.path, ".kilo-cutover-"))
  const journal = path.join(root.path, "stage.json")
  const markLinking = beginStage(journal, file, scratch)
  markLinking()
  fs.linkSync(file, backup)

  fs.writeFileSync(`${file}-wal`, "uncheckpointed")
  expect(() => retryPublication(file, backup, journal)).toThrow("inspect recovery sidecars")
  expect(fs.existsSync(backup)).toBe(true)

  fs.writeFileSync(`${file}-wal`, "")
  fs.writeFileSync(`${file}-shm`, "stale")
  retryPublication(file, backup, journal)
  expect(fs.existsSync(backup)).toBe(false)
  expect(fs.existsSync(`${file}-wal`)).toBe(false)
  expect(fs.existsSync(`${file}-shm`)).toBe(false)
  expect(fs.existsSync(scratch)).toBe(false)
  expect(fs.existsSync(journal)).toBe(false)
})
