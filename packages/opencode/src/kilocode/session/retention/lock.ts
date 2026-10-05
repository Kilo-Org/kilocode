import os from "os"
import path from "path"
import { readFile, stat } from "fs/promises"
import { Flock } from "@opencode-ai/core/util/flock"

export namespace KiloRetentionLock {
  export const key = "session-retention"

  // A live owner writes its metadata right after it creates the lock directory.
  const grace = 60_000

  function code(err: unknown) {
    if (typeof err !== "object" || err === null || !("code" in err)) return
    return err.code
  }

  /**
   * True when the lock owner is known to be dead, so the lock can be recovered
   * before the one-day lease expires:
   * - The lock directory has no metadata and is older than the grace period.
   *   A process that exits while it creates the lock leaves this state.
   * - The metadata names a same-host PID that no longer exists.
   *
   * Malformed metadata, a live PID (it can be reused by another process) and
   * probe errors return false, so the caller falls back to the heartbeat age.
   */
  export async function dead(file: string) {
    const missing = await stat(file).then(
      () => false,
      (err: unknown) => code(err) === "ENOENT",
    )
    if (missing) {
      const dir = await stat(path.dirname(file)).catch(() => undefined)
      return dir !== undefined && Date.now() - dir.mtimeMs > grace
    }
    const meta = await readFile(file, "utf8")
      .then((raw): unknown => JSON.parse(raw))
      .catch(() => undefined)
    if (!meta || typeof meta !== "object") return false
    if (!("hostname" in meta) || meta.hostname !== os.hostname()) return false
    if (!("token" in meta) || typeof meta.token !== "string" || meta.token.length === 0) return false
    if (!("pid" in meta) || typeof meta.pid !== "number" || !Number.isSafeInteger(meta.pid) || meta.pid <= 0)
      return false
    try {
      process.kill(meta.pid, 0)
      return false
    } catch (err) {
      return code(err) === "ESRCH"
    }
  }

  // The one-day lease keeps a live owner whose heartbeat is starved by a long
  // pass. Acquisition waits at most one second, so callers can report busy.
  export const acquire = () => Flock.effect(key, { timeoutMs: 1000, staleMs: 86_400_000, dead })
}
