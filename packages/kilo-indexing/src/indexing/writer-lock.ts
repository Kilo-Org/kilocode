import { createHash, randomUUID } from "crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Log } from "../util/log"

const log = Log.create({ service: "indexing-writer-lock" })

const STALE_MS = 60_000
const BEAT_MS = Math.floor(STALE_MS / 3)

export type Writer = {
  release: () => Promise<void>
}

type Meta = {
  token: string
  pid: number
  host: string
}

function key(workspacePath: string): string {
  return createHash("sha256").update(workspacePath).digest("hex").substring(0, 16)
}

function code(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined
  return typeof err.code === "string" ? err.code : undefined
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return code(err) === "EPERM"
  }
}

async function age(file: string): Promise<number | undefined> {
  try {
    return Date.now() - (await fs.stat(file)).mtimeMs
  } catch (err) {
    if (code(err) === "ENOENT") return undefined
    throw err
  }
}

async function read(file: string): Promise<Meta | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf-8"))
    if (typeof parsed !== "object" || parsed === null) return undefined
    if (!("token" in parsed) || !("pid" in parsed) || !("host" in parsed)) return undefined
    return { token: String(parsed.token), pid: Number(parsed.pid), host: String(parsed.host) }
  } catch (err) {
    log.error("writer lock metadata unreadable", { err, file })
    return undefined
  }
}

async function claim(lockdir: string): Promise<boolean> {
  try {
    await fs.mkdir(lockdir)
    return true
  } catch (err) {
    if (code(err) === "EEXIST") return false
    throw err
  }
}

/**
 * A lock whose owner died leaves its directory behind forever, so ownership is
 * decided by liveness rather than presence: a heartbeat that stopped, or a
 * local pid that no longer exists, means the directory is safe to take.
 */
async function reclaimable(lockdir: string): Promise<boolean> {
  const beat = path.join(lockdir, "heartbeat")
  const meta = path.join(lockdir, "meta.json")

  const beatAge = await age(beat)
  if (beatAge !== undefined) return beatAge > STALE_MS

  const owner = await read(meta)
  if (owner && owner.host === os.hostname() && !alive(owner.pid)) {
    log.info("reclaiming writer lock from a dead local owner", { pid: owner.pid })
    return true
  }

  const metaAge = await age(meta)
  if (metaAge !== undefined) return metaAge > STALE_MS

  const dirAge = await age(lockdir)
  return dirAge !== undefined && dirAge > STALE_MS
}

/**
 * Takes the writer lock for a workspace, or resolves undefined when another
 * live session already holds it. Callers must not write to the vector store
 * without holding this.
 */
export async function acquire(dir: string, workspacePath: string): Promise<Writer | undefined> {
  const root = path.join(dir, "locks")
  const lockdir = path.join(root, key(workspacePath))

  await fs.mkdir(root, { recursive: true })
  const made = await claim(lockdir)
  if (!made) {
    if (!(await reclaimable(lockdir))) {
      log.info("writer lock held by another session", { workspacePath })
      return undefined
    }
    log.info("reclaiming stale writer lock", { workspacePath })
    await fs.rm(lockdir, { recursive: true, force: true })
    if (!(await claim(lockdir))) {
      log.info("lost the race for a stale writer lock", { workspacePath })
      return undefined
    }
  }

  const token = randomUUID()
  const owner = { token, pid: process.pid, host: os.hostname(), at: new Date().toISOString() }
  await fs.writeFile(path.join(lockdir, "meta.json"), JSON.stringify(owner))
  await fs.writeFile(path.join(lockdir, "heartbeat"), "")

  const timer = setInterval(() => {
    const now = new Date()
    void fs
      .utimes(path.join(lockdir, "heartbeat"), now, now)
      .catch((err) => log.error("writer lock heartbeat failed", { err }))
  }, BEAT_MS)
  timer.unref?.()

  return {
    release: async () => {
      clearInterval(timer)
      const current = await read(path.join(lockdir, "meta.json"))
      if (current && current.token !== token) {
        log.error("refusing to release a writer lock owned by another session", { workspacePath })
        return
      }
      await fs.rm(lockdir, { recursive: true, force: true })
      log.info("released writer lock", { workspacePath })
    },
  }
}
