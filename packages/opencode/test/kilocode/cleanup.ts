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
    if (process.platform === "win32") Bun.gc(true)
    return fs
      .rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      .catch(async (error) => {
        if (!locked(error)) throw error
        if (left <= 1) throw error
        await Bun.sleep(cfg.delay)
        return rm(left - 1)
      })
  }
  return rm(cfg.retries)
}
