import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Log } from "../../src/util"
import * as Process from "../../src/util/process" // kilocode_change
import { tmpdir } from "../fixture/fixture"

const log = Global.Path.log

afterEach(() => {
  Global.Path.log = log
})

async function files(dir: string) {
  let last = ""
  let same = 0

  for (let i = 0; i < 50; i++) {
    const list = (await fs.readdir(dir)).sort()
    const next = JSON.stringify(list)
    same = next === last ? same + 1 : 0
    if (same >= 2 && list.length === 11) return list
    last = next
    await Bun.sleep(10)
  }

  return (await fs.readdir(dir)).sort()
}

test("init cleanup keeps the newest timestamped logs", async () => {
  await using tmp = await tmpdir()
  Global.Path.log = tmp.path

  const list = Array.from({ length: 12 }, (_, i) => `2000-01-${String(i + 1).padStart(2, "0")}T000000.log`)

  await Promise.all(list.map((file) => fs.writeFile(path.join(tmp.path, file), file)))

  await Log.init({ print: false, dev: false })

  const next = await files(tmp.path)

  expect(next).not.toContain(list[0]!)
  expect(next).toContain(list.at(-1)!)
})

// kilocode_change start
const root = path.join(import.meta.dir, "../..")
const worker = path.join(import.meta.dir, "../fixture/log-init-worker.ts")

test("uses single log directory for rotation history", async () => {
  await using tmp = await tmpdir()

  const out = await Process.run([process.execPath, "--conditions=browser", worker, tmp.path], {
    cwd: root,
    nothrow: true,
  })

  const dir = path.join(tmp.path, "share", "kilo", "log")
  const history = path.join(dir, ".log-history")

  expect(out.code).toBe(0)
  expect(out.stderr.toString()).not.toContain("log stream error:")
  expect(out.stdout.toString()).toBe(path.join(dir, "dev.log"))

  const stat = await fs.stat(history)
  expect(stat.isFile()).toBe(true)
})

test("skips rotation rename when active log file is missing", async () => {
  await using tmp = await tmpdir()

  const out = await Process.run([process.execPath, "--conditions=browser", worker, tmp.path, "missing"], {
    cwd: root,
    nothrow: true,
  })

  const dir = path.join(tmp.path, "share", "kilo", "log")
  const list = (await fs.readdir(dir)).sort()
  const next = list.filter((file) => /^\d{8}-\d{4}-\d{2}-dev\.log$/.test(file))
  const stat = await fs.stat(path.join(dir, next[0]!))

  expect(out.code).toBe(0)
  expect(out.stderr.toString()).not.toContain("log stream error:")
  expect(list).toContain("dev.log")
  expect(next).toHaveLength(1)
  expect(stat.size).toBe(0)
})
// kilocode_change end
