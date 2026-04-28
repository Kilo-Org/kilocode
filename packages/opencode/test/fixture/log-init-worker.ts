// kilocode_change - new file

import fs from "fs/promises"
import path from "path"

const dir = process.argv[2]
const mode = process.argv[3]

if (!dir) {
  throw new Error("missing temp dir")
}

process.env.XDG_DATA_HOME = path.join(dir, "share")
process.env.XDG_CACHE_HOME = path.join(dir, "cache")
process.env.XDG_CONFIG_HOME = path.join(dir, "config")
process.env.XDG_STATE_HOME = path.join(dir, "state")
process.env.KILO_TEST_HOME = path.join(dir, "home")

const Log = await import("../../src/util/log")

async function bytes(file: string) {
  return fs
    .stat(file)
    .then((stat) => stat.size)
    .catch(() => 0)
}

async function wait(file: string, need: number) {
  for (let i = 0; i < 500; i++) {
    if ((await bytes(file)) >= need) return
    await Bun.sleep(10)
  }

  throw new Error(`log file did not reach ${need} bytes before missing-file test`)
}

await Log.init({
  print: false,
  dev: true,
  level: "DEBUG",
})

const log = Log.create({ service: "test" })
const msg = "x".repeat(1024 * 1024)
const first = mode === "missing" ? 10 : 55

await fs.mkdir(path.join(dir, "share", "kilo", "log"), { recursive: true })
for (const _ of Array.from({ length: first })) {
  log.info(msg)
}

if (mode === "missing") {
  await wait(Log.file(), first * msg.length)
  await fs.unlink(Log.file())

  for (const _ of Array.from({ length: 45 })) {
    log.info(msg)
  }
}

await Bun.sleep(300)

process.stdout.write(Log.file())
