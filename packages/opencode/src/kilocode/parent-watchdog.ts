import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "parent-watchdog" })

/**
 * Exit the server when the embedded client that spawned it dies.
 *
 * Editor clients (VS Code extension, JetBrains plugin) run `kilo serve` as a child
 * process. A graceful client shutdown signals the server, but a hard kill (SIGKILL,
 * crash, OOM) never gets the chance, orphaning the server. The client passes its own
 * PID via `KILO_PARENT_PID`; we poll that PID and re-parenting so the server shuts
 * itself down when the client is gone.
 *
 * No-op unless `KILO_PARENT_PID` is set to a valid PID, so a manually launched
 * `kilo serve` (whose parent shell exiting may be intentional) is never affected.
 *
 * Returns a function that stops the watchdog.
 */
export function startParentWatchdog(onOrphan: () => void, intervalMs = 1000): () => void {
  const configured = Number(process.env["KILO_PARENT_PID"])
  if (!Number.isInteger(configured) || configured <= 0) return () => {}
  const initial = process.ppid
  log.info("watching parent process", { parent: configured, ppid: initial, intervalMs })
  const timer = setInterval(() => {
    if (!orphaned(configured, initial)) return
    clearInterval(timer)
    log.info("parent process gone — shutting down server", { parent: configured })
    onOrphan()
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

function orphaned(parent: number, initial: number): boolean {
  // Re-parented away from the spawner (parent already exited on some platforms).
  if (initial !== 1 && process.ppid !== initial) return true
  if (parent === 1) return false
  try {
    // Signal 0 probes liveness without delivering a signal.
    process.kill(parent, 0)
    return false
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ESRCH") return true
    // EPERM etc. means the process still exists; treat only "no such process" as dead.
    log.debug("parent liveness check inconclusive", { parent, code })
    return false
  }
}
