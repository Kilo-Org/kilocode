import path from "path"
import os from "os"
import fs from "fs/promises"
import { rmSync, writeFileSync, mkdirSync } from "fs"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import type { SessionID } from "@/session/schema"

/**
 * Marks the sessions whose turn runs in this process. Session status lives in each process, so another
 * Kilo process on the same data directory reads these markers to tell a live reply from one that a
 * crashed process left behind.
 *
 * A marker is a file named `<sessionID>.<pid>` that holds the host name. The holder refreshes its mtime
 * while the turn runs. On this host a marker is live while its pid is alive, up to a day without a refresh,
 * so a suspended process keeps it and a reused pid does not keep it forever. A marker from another host is
 * live for a minute after its last refresh. The files are written and removed synchronously, so a release
 * and the next hold for the same session cannot reorder on disk.
 */
export namespace KiloSessionTurn {
  const log = Log.create({ service: "session-turn" })
  // A marker from another host that its holder has not refreshed for this long belongs to a dead process.
  const ttl = 60_000
  // A local marker older than this belongs to a reused pid, not to a suspended holder.
  const limit = 24 * 60 * 60_000
  const held = new Map<SessionID, { count: number; timer?: ReturnType<typeof setInterval> }>()

  function dir() {
    return path.join(Global.Path.state, "session-turn")
  }

  function file(id: SessionID, pid: number) {
    return path.join(dir(), `${id}.${pid}`)
  }

  function alive(pid: number) {
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "EPERM"
    }
  }

  /** Wraps a run lease so that the marker exists from before the run starts until the run ends. */
  export function hold(id: SessionID, lease: Effect.Effect<() => void>) {
    return Effect.gen(function* () {
      const release = yield* lease
      const entry = held.get(id) ?? { count: 0 }
      held.set(id, entry)
      entry.count++
      if (entry.count === 1) {
        const marker = file(id, process.pid)
        try {
          mkdirSync(dir(), { recursive: true })
          writeFileSync(marker, os.hostname())
          entry.timer = setInterval(() => {
            const now = new Date()
            fs.utimes(marker, now, now).catch((err) => log.warn("failed to refresh session turn", { err, id }))
          }, ttl / 3)
          entry.timer.unref?.()
        } catch (err) {
          log.warn("failed to mark session turn", { err, id })
        }
      }
      let active = true
      return () => {
        if (!active) return
        active = false
        release()
        entry.count--
        if (entry.count > 0) return
        held.delete(id)
        clearInterval(entry.timer)
        try {
          rmSync(file(id, process.pid), { force: true })
        } catch (err) {
          log.warn("failed to clear session turn", { err, id })
        }
      }
    })
  }

  /**
   * Returns true when another live Kilo process runs a turn on the session. The scan removes stale markers
   * of every session.
   */
  export const foreign = Effect.fn("KiloSessionTurn.foreign")(function* (id: SessionID) {
    const names = yield* Effect.promise(() =>
      fs.readdir(dir()).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") log.warn("failed to read session turns", { err, id })
        return [] as string[]
      }),
    )
    const host = os.hostname()
    let live = false
    for (const name of names) {
      const at = name.lastIndexOf(".")
      const pid = Number(name.slice(at + 1))
      if (at < 0 || !Number.isInteger(pid)) continue
      const marker = path.join(dir(), name)
      const found = yield* Effect.promise(() =>
        Promise.all([fs.stat(marker), fs.readFile(marker, "utf8")]).catch(() => undefined),
      )
      if (!found) continue
      const local = found[1] === host
      // This process tracks its own turns through session status.
      if (local && pid === process.pid) continue
      const age = Date.now() - found[0].mtimeMs
      const stale = local ? age > limit || !alive(pid) : age > ttl
      if (!stale) {
        if (name.slice(0, at) === id) live = true
        continue
      }
      yield* Effect.promise(() =>
        fs.rm(marker, { force: true }).catch((err) => log.warn("failed to remove stale session turn", { err, pid })),
      )
    }
    return live
  })
}
