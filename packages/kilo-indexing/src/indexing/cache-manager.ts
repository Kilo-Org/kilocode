import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import type { ICacheManager } from "./interfaces/cache"
import { Log } from "../util/log"

const log = Log.create({ service: "indexing-cache" })

/**
 * Manages the file-hash cache for code indexing.
 *
 * RATIONALE: Replaced vscode.ExtensionContext storage and vscode.workspace.fs
 * with plain filesystem access so the cache manager works outside VS Code.
 */
export class CacheManager implements ICacheManager {
  private readonly cachePath: string
  private fileHashes: Record<string, string> = {}
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private saveTask = Promise.resolve()

  constructor(
    private readonly cacheDirectory: string,
    private readonly workspacePath: string,
  ) {
    const hash = createHash("sha256").update(workspacePath).digest("hex")
    this.cachePath = path.join(cacheDirectory, `roo-index-cache-${hash}.json`)
  }

  async initialize(): Promise<void> {
    try {
      const raw = await fs.readFile(this.cachePath, "utf-8")
      this.fileHashes = JSON.parse(raw)
    } catch {
      this.fileHashes = {}
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      void this.flush().catch((err) => log.error("failed to save cache", { err }))
    }, 1500)
  }

  private async performSave(): Promise<void> {
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true })
    const tmp = `${this.cachePath}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.fileHashes), "utf-8")
    await fs.rename(tmp, this.cachePath)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    const task = this.saveTask.then(() => this.performSave())
    this.saveTask = task.catch((err) => {
      log.error("failed to save cache", { err })
    })
    await task
  }

  seedHashes(hashes: Readonly<Record<string, string>>): void {
    this.fileHashes = { ...hashes }
    this.scheduleSave()
  }

  async clearCacheFile(): Promise<void> {
    this.fileHashes = {}
    await this.flush()
  }

  getHash(filePath: string): string | undefined {
    return this.fileHashes[filePath]
  }

  updateHash(filePath: string, hash: string): void {
    this.fileHashes[filePath] = hash
    this.scheduleSave()
  }

  deleteHash(filePath: string): void {
    delete this.fileHashes[filePath]
    this.scheduleSave()
  }

  getAllHashes(): Record<string, string> {
    return { ...this.fileHashes }
  }

  signature(): string {
    const entries = Object.entries(this.fileHashes).sort(([left], [right]) => left.localeCompare(right))
    return createHash("sha256").update(JSON.stringify(entries)).digest("hex")
  }

  async stamp(): Promise<string | undefined> {
    return fs
      .stat(this.cachePath)
      .then((value) => `${value.mtimeMs}:${value.ctimeMs}:${value.size}`)
      .catch(() => undefined)
  }
}
