import fs from "fs/promises"
import path from "path"
import { Log } from "../../util/log"

const log = Log.create({ service: "indexing-file-lock" })

/**
 * Simple cross-process file lock using atomic mkdir.
 *
 * RATIONALE: We need a lock that works across separate Node.js processes
 * indexing the same workspace. The `async-mutex` package only works within
 * a single process. This uses the atomicity of `fs.mkdir` with `{ recursive: false }`
 * to ensure only one process acquires the lock.
 */
export class FileLock {
  private readonly lockDir: string
  private readonly metaPath: string
  private acquired = false

  constructor(
    private readonly workspacePath: string,
    private readonly cacheDirectory: string,
  ) {
    const hash = Buffer.from(workspacePath).toString("base64url")
    this.lockDir = path.join(cacheDirectory, "locks", `index-${hash}`)
    this.metaPath = path.join(this.lockDir, "meta.json")
  }

  /**
   * Try to acquire the lock without blocking.
   * @returns true if lock was acquired
   */
  async tryLock(): Promise<boolean> {
    try {
      await fs.mkdir(this.lockDir, { recursive: false })
      await fs.writeFile(
        this.metaPath,
        JSON.stringify({ pid: process.pid, time: Date.now() }),
        "utf-8",
      )
      this.acquired = true
      log.info("acquired indexing lock", { workspacePath: this.workspacePath, lockDir: this.lockDir })
      return true
    } catch (err: any) {
      if (err.code === "EEXIST") {
        return false
      }
      throw err
    }
  }

  /**
   * Acquire the lock, waiting up to timeoutMs.
   * @param timeoutMs Maximum time to wait (default: 30s)
   * @param pollMs Polling interval (default: 500ms)
   */
  async acquire(timeoutMs = 30_000, pollMs = 500): Promise<boolean> {
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
      if (await this.tryLock()) return true
      await sleep(pollMs)
    }

    log.warn("timed out waiting for indexing lock", {
      workspacePath: this.workspacePath,
      timeoutMs,
    })
    return false
  }

  /**
   * Release the lock if we hold it.
   */
  async release(): Promise<void> {
    if (!this.acquired) return
    try {
      await fs.rm(this.lockDir, { recursive: true, force: true })
      this.acquired = false
      log.info("released indexing lock", { workspacePath: this.workspacePath })
    } catch (err) {
      log.error("failed to release indexing lock", { err, workspacePath: this.workspacePath })
    }
  }

  /**
   * Check if the lock is currently held by any process.
   */
  async isLocked(): Promise<boolean> {
    try {
      await fs.access(this.lockDir)
      return true
    } catch {
      return false
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
