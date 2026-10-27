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
 * A marker is a file named `<sessionID>.<pid>` that holds the host name. The files are written and removed
 * synchronously, so a release and the next hold for the same session cannot reorder on disk.
 */
export namespace KiloSessionTurn {
  const log = Log.create({ service: "session-turn" })
  const counts = new Map<SessionID, number>()

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
      const count = counts.get(id) ?? 0
      counts.set(id, count + 1)
      if (count === 0) {
        try {
          mkdirSync(dir(), { recursive: true })
          writeFileSync(file(id, process.pid), os.hostname())
        } catch (err) {
          log.warn("failed to mark session turn", { err, id })
        }
      }
      let held = true
      return () => {
        if (!held) return
        held = false
        release()
        const left = (counts.get(id) ?? 1) - 1
        if (left > 0) {
          counts.set(id, left)
          return
        }
        counts.delete(id)
        try {
          rmSync(file(id, process.pid), { force: true })
        } catch (err) {
          log.warn("failed to clear session turn", { err, id })
        }
      }
    })
  }

  /**
   * Returns true when another live Kilo process runs a turn on the session. A marker from another host
   * counts as live, because its process cannot be checked. Markers of dead processes are removed.
   */
  export const foreign = Effect.fn("KiloSessionTurn.foreign")(function* (id: SessionID) {
    const names = yield* Effect.promise(() =>
      fs.readdir(dir()).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") log.warn("failed to read session turns", { err, id })
        return [] as string[]
      }),
    )
    for (const name of names) {
      if (!name.startsWith(`${id}.`)) continue
      const pid = Number(name.slice(id.length + 1))
      if (!Number.isInteger(pid) || pid === process.pid) continue
      const host = yield* Effect.promise(() =>
        fs.readFile(path.join(dir(), name), "utf8").catch(() => undefined),
      )
      if (host === undefined) continue
      if (host !== os.hostname() || alive(pid)) return true
      yield* Effect.promise(() =>
        fs
          .rm(path.join(dir(), name), { force: true })
          .catch((err) => log.warn("failed to remove stale session turn", { err, id, pid })),
      )
    }
    return false
  })
}
