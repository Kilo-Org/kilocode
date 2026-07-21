import * as fs from "fs/promises"

function opts() {
  return process.platform === "win32" ? { retries: 60, delay: 500 } : { retries: 5, delay: 100 }
}

function locked(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["EBUSY", "EACCES", "EPERM"].includes(String(error.code))
  )
}

export async function remove(dir: string) {
  const cfg = opts()
  const rm = async (left: number): Promise<void> => {
    return fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(async (error) => {
      if (!locked(error)) throw error
      if (left <= 1) throw error
      // bun:sqlite connections release their file handles on GC finalization, not on Effect scope
      // closure, so Windows needs a GC pass per retry: a connection that becomes unreachable after
      // a single early pass would otherwise never finalize while this loop only sleeps.
      if (process.platform === "win32") Bun.gc(true)
      await Bun.sleep(cfg.delay)
      return rm(left - 1)
    })
  }
  return rm(cfg.retries)
}
