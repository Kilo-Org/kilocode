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
    this.saveTimer = setTimeout(() => this.performSave(), 1500)
  }

  private async performSave(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true })
      const tmp = `${this.cachePath}.tmp`
      await fs.writeFile(tmp, JSON.stringify(this.fileHashes), "utf-8")
      await fs.rename(tmp, this.cachePath)
    } catch (err) {
      log.error("failed to save cache", { err })
    }
  }

  async clearCacheFile(): Promise<void> {
    try {
      this.fileHashes = {}
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true })
      await fs.writeFile(this.cachePath, "{}", "utf-8")
    } catch (err) {
      log.error("failed to clear cache file", { err })
    }
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
}
