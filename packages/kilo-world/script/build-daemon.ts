#!/usr/bin/env bun
import fs from "node:fs/promises"
import path from "node:path"
import { WorldDaemon } from "./daemon"
import { fingerprint, fresh, LOCK, LOCK_TIMEOUT_MS, STAMP } from "../src/daemon/build"

const dir = path.resolve(import.meta.dirname, "../dist")
const root = path.dirname(dir)
await fs.mkdir(dir, { recursive: true })
const manifest = path.join(dir, WorldDaemon.manifest)
const lock = path.join(dir, LOCK)
const key = await fingerprint(path.resolve(import.meta.dirname, ".."))
const handle = await acquire(Date.now() + LOCK_TIMEOUT_MS)
const pulse = setInterval(() => {
  const now = new Date()
  void handle.utimes(now, now).catch((err: unknown) => {
    process.stderr.write(`failed to refresh kilo-world daemon build lock: ${String(err)}\n`)
  })
}, 1000)
try {
  await clean()
  await build()
} finally {
  clearInterval(pulse)
  await release(handle)
}

async function build(): Promise<void> {
  if (await fresh(dir, key, WorldDaemon.filename, WorldDaemon.manifest)) return
  const stage = await fs.mkdtemp(path.join(root, ".world-daemon-"))
  try {
    const file = await WorldDaemon.copy(await WorldDaemon.bundle(), stage)
    await Bun.write(path.join(stage, STAMP), `${key}\n`)
    const files: unknown = JSON.parse(await Bun.file(path.join(stage, WorldDaemon.manifest)).text())
    if (!Array.isArray(files) || !files.every((item) => typeof item === "string")) {
      throw new Error("kilo-world daemon build wrote an invalid manifest")
    }
    const names = [...new Set([...files, STAMP])]
    await Bun.write(path.join(stage, WorldDaemon.manifest), `${JSON.stringify(names, null, 2)}\n`)
    await WorldDaemon.smoke(file, path.join(stage, "smoke"))

    const previous = await listed(manifest)
    const chunks = names.filter(
      (name) => name !== WorldDaemon.filename && name !== WorldDaemon.manifest && name !== STAMP,
    )
    for (const name of [...chunks, WorldDaemon.filename, WorldDaemon.manifest, STAMP]) {
      await fs.rename(path.join(stage, name), path.join(dir, name))
    }
    await Promise.all(
      previous.filter((name) => !names.includes(name)).map((name) => fs.rm(path.join(dir, name), { force: true })),
    )
    console.log(`built ${path.join(dir, WorldDaemon.filename)}`)
  } finally {
    await fs.rm(stage, { recursive: true, force: true })
  }
}

async function acquire(deadline: number): Promise<fs.FileHandle> {
  try {
    const file = await fs.open(lock, "wx", 0o600)
    await file.writeFile(`${process.pid}\n`)
    return file
  } catch (err) {
    if (!(err instanceof Error) || !("code" in err) || err.code !== "EEXIST") throw err
    if (!(await alive())) await fs.rm(lock, { force: true })
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for kilo-world daemon build lock: ${lock}`, { cause: err })
    }
    await Bun.sleep(100)
    return acquire(deadline)
  }
}

async function alive(): Promise<boolean> {
  const age = await fs
    .stat(lock)
    .then((value) => Date.now() - value.mtimeMs)
    .catch(() => Number.POSITIVE_INFINITY)
  if (age >= LOCK_TIMEOUT_MS) return false
  const pid = await fs
    .readFile(lock, "utf8")
    .then((value) => Number(value.trim()))
    .catch(() => Number.NaN)
  if (!Number.isSafeInteger(pid) || pid <= 0) return age < 5000
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "EPERM"
  }
}

async function release(handle: fs.FileHandle): Promise<void> {
  const owner = await handle.stat()
  const current = await fs.stat(lock).catch(() => undefined)
  await handle.close()
  if (!current || owner.dev !== current.dev || owner.ino !== current.ino) return
  await fs.rm(lock, { force: true })
}

async function listed(file: string): Promise<string[]> {
  const files: unknown = await Bun.file(file)
    .json()
    .catch(() => [])
  if (!Array.isArray(files)) return []
  return files.filter((item): item is string => typeof item === "string").map((item) => path.basename(item))
}

async function clean(): Promise<void> {
  const files = await fs.readdir(root, { withFileTypes: true })
  await Promise.all(
    files
      .filter((file) => file.isDirectory() && file.name.startsWith(".world-daemon-"))
      .map((file) => fs.rm(path.join(root, file.name), { recursive: true, force: true })),
  )
}
