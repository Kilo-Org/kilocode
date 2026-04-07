import z from "zod"
import fs from "fs/promises"
import path from "path"

export const FileLock = z.object({
  taskId: z.string(),
  role: z.string(),
  files: z.array(z.string()),
  lockedAt: z.string(),
})
export type FileLock = z.infer<typeof FileLock>

const LocksFile = z.object({
  locks: z.array(FileLock).default([]),
})

export class LockManager {
  private lockPath: string

  constructor(planningDir: string) {
    this.lockPath = path.join(planningDir, "locks.json")
  }

  private async read(): Promise<FileLock[]> {
    try {
      const raw = await fs.readFile(this.lockPath, "utf-8")
      const parsed = LocksFile.parse(JSON.parse(raw))
      return parsed.locks
    } catch {
      return []
    }
  }

  private async write(locks: FileLock[]): Promise<void> {
    await fs.writeFile(this.lockPath, JSON.stringify({ locks }, null, 2))
  }

  async acquire(taskId: string, role: string, files: string[]): Promise<void> {
    const locks = await this.read()
    // Remove existing lock for this task (re-acquire)
    const filtered = locks.filter((l) => l.taskId !== taskId)
    filtered.push({
      taskId,
      role,
      files,
      lockedAt: new Date().toISOString(),
    })
    await this.write(filtered)
  }

  async release(taskId: string): Promise<void> {
    const locks = await this.read()
    await this.write(locks.filter((l) => l.taskId !== taskId))
  }

  async releaseAll(): Promise<void> {
    await this.write([])
  }

  async listLocks(): Promise<FileLock[]> {
    return this.read()
  }

  async checkConflicts(files: string[]): Promise<FileLock[]> {
    const locks = await this.read()
    const fileSet = new Set(files)
    return locks.filter((lock) => lock.files.some((f) => fileSet.has(f)))
  }

  async findOrphanedLocks(
    terminalStatuses: Set<string>,
    getTaskStatus: (taskId: string) => string | undefined,
  ): Promise<FileLock[]> {
    const locks = await this.read()
    return locks.filter((lock) => {
      const status = getTaskStatus(lock.taskId)
      return status !== undefined && terminalStatuses.has(status)
    })
  }
}
