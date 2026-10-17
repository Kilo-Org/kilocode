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
 *
 * A vanished directory reports as reclaimable: without this, a session that
 * lost the race on `claim` would treat its own missing directory (deleted by
 * the winner's reclaim just before its claim) as held-forever and wedge in
 * Standby instead of retrying the claim.
 */
async function reclaimable(lockdir: string): Promise<boolean> {
  const beat = path.join(lockdir, "heartbeat")
  const meta = path.join(lockdir, "meta.json")

  // Check the dead-local-owner fast path before heartbeat freshness: a dead
  // pid cannot refresh its heartbeat, so waiting out STALE_MS on a fresh file
  // only delays an inevitable reclaim. (Pid reuse is safe: a reused pid reads
  // alive and falls through to the age checks.)
  const owner = await read(meta)
  if (owner && owner.host === os.hostname() && !alive(owner.pid)) {
    log.info("reclaiming writer lock from a dead local owner", { pid: owner.pid })
    return true
  }

  const beatAge = await age(beat)
  if (beatAge !== undefined) return beatAge > STALE_MS

  const metaAge = await age(meta)
  if (metaAge !== undefined) return metaAge > STALE_MS

  const dirAge = await age(lockdir)
  if (dirAge === undefined) return true
  return dirAge > STALE_MS
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
  if (!(await claim(lockdir))) {
    if (!(await reclaimable(lockdir))) {
      log.info("writer lock held by another session", { workspacePath })
      return undefined
    }
    log.info("reclaiming stale writer lock", { workspacePath })
  // Atomic reclaim: rename (same-filesystem atomic) instead of rm+mkdir, so
  // two reclaimers cannot both delete each other's fresh claim and both
  // become writers. The loser of the rename claims from scratch: if its claim
  // loses, the directory it sees is the winner's fresh lock, which reports
  // held rather than free.
    if (!(await reclaim(lockdir))) {
      log.info("lost the race for a stale writer lock", { workspacePath })
      return undefined
    }
  }

  const token = randomUUID()
  const owner = { token, pid: process.pid, host: os.hostname(), at: new Date().toISOString() }
  try {
    await fs.writeFile(path.join(lockdir, "meta.json"), JSON.stringify(owner))
    await fs.writeFile(path.join(lockdir, "heartbeat"), "")
  } catch (err) {
    // A failed write after winning the claim must not leave the lock held and
    // fresh: roll the directory back so a later session sees it as stale or
    // retries the claim, and surface the error instead of an unhandled
    // rejection escaping runIndexing.
    await fs.rm(lockdir, { recursive: true, force: true })
    throw err
  }

  let held = true
  const timer = setInterval(() => {
    if (!held) return
    const now = new Date()
    void (async () => {
      // Stop beating once displaced: without the ownership check a taken-over
      // owner keeps refreshing the new owner's heartbeat and may resume
      // writing while it believes the lock is still its own.
      const current = await read(path.join(lockdir, "meta.json"))
      if (!current || current.token !== token) {
        held = false
        clearInterval(timer)
        return
      }
      await fs.utimes(path.join(lockdir, "heartbeat"), now, now)
    })().catch((err) => log.error("writer lock heartbeat failed", { err }))
  }, BEAT_MS)
  timer.unref?.()

  return {
    release: async () => {
      held = false
      clearInterval(timer)
      const current = await read(path.join(lockdir, "meta.json"))
      if (!current || current.token !== token) {
        // The directory (or its meta) belongs to another session now: the
        // takeover rewrote it, or it vanished and was reclaimed. Either way
        // deleting it would remove a lock this session no longer owns.
        if (current) log.error("refusing to release a writer lock owned by another session", { workspacePath })
        return
      }
      await fs.rm(lockdir, { recursive: true, force: true })
      log.info("released writer lock", { workspacePath })
    },
  }
}

async function reclaim(lockdir: string): Promise<boolean> {
  const stale = `${lockdir}.stale.${process.pid}.${Date.now()}`
  try {
    await fs.rename(lockdir, stale)
  } catch (err) {
    // ENOENT means the directory vanished between the reclaimable check and
    // the rename — i.e. the lock is free, not lost to a rival. Claim it
    // instead of reporting a lost race and wedging the session in Standby.
    if (code(err) !== "ENOENT") return false
    return claim(lockdir)
  }
  void fs.rm(stale, { recursive: true, force: true }).catch((err) => log.error("writer lock stale cleanup failed", { err }))
  return claim(lockdir)
}
