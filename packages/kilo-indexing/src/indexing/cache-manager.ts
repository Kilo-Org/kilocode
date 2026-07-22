import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import type { CacheMetadata, ICacheManager } from "./interfaces/cache"
import { Log } from "../util/log"

const log = Log.create({ service: "indexing-cache" })
const VERSION = 2

type Entry = {
  hash: string
  size?: number
  mtimeMs?: number
  ctimeMs?: number
}

type Data = {
  version: typeof VERSION
  files: Record<string, Entry>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Manages the file-hash cache for code indexing.
 *
 * RATIONALE: Replaced vscode.ExtensionContext storage and vscode.workspace.fs
 * with plain filesystem access so the cache manager works outside VS Code.
 */
export class CacheManager implements ICacheManager {
  private readonly cachePath: string
  private files: Record<string, Entry> = {}
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
      const data: unknown = JSON.parse(await fs.readFile(this.cachePath, "utf-8"))
      if (!isRecord(data)) {
        this.files = {}
        return
      }

      if ("version" in data) {
        if (data.version !== VERSION || !isRecord(data.files)) {
          this.files = {}
          return
        }

        this.files = Object.fromEntries(
          Object.entries(data.files).flatMap(([file, value]) => {
            if (!isRecord(value) || typeof value.hash !== "string") return []
            const metadata =
              typeof value.size === "number" &&
              Number.isFinite(value.size) &&
              typeof value.mtimeMs === "number" &&
              Number.isFinite(value.mtimeMs) &&
              typeof value.ctimeMs === "number" &&
              Number.isFinite(value.ctimeMs)
            return metadata
              ? [[file, { hash: value.hash, size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs }]]
              : [[file, { hash: value.hash }]]
          }),
        )
        return
      }

      this.files = Object.fromEntries(
        Object.entries(data).flatMap(([file, value]) => (typeof value === "string" ? [[file, { hash: value }]] : [])),
      )
    } catch {
      this.files = {}
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
    const data: Data = { version: VERSION, files: this.files }
    await fs.writeFile(tmp, JSON.stringify(data), "utf-8")
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
    this.files = Object.fromEntries(Object.entries(hashes).map(([file, hash]) => [file, { hash }]))
    this.scheduleSave()
  }

  async clearCacheFile(): Promise<void> {
    this.files = {}
    await this.flush()
  }

  getHash(filePath: string): string | undefined {
    return this.files[filePath]?.hash
  }

  getMetadata(filePath: string): CacheMetadata | undefined {
    const entry = this.files[filePath]
    if (entry?.size === undefined || entry.mtimeMs === undefined || entry.ctimeMs === undefined) return
    return { size: entry.size, mtimeMs: entry.mtimeMs, ctimeMs: entry.ctimeMs }
  }

  updateHash(filePath: string, hash: string, metadata?: CacheMetadata): void {
    this.files[filePath] = metadata ? { hash, ...metadata } : { hash }
    this.scheduleSave()
  }

  deleteHash(filePath: string): void {
    delete this.files[filePath]
    this.scheduleSave()
  }

  getAllHashes(): Record<string, string> {
    return Object.fromEntries(Object.entries(this.files).map(([file, entry]) => [file, entry.hash]))
  }

  signature(): string {
    const entries = Object.entries(this.files)
      .map(([file, entry]) => [file, entry.hash])
      .sort(([left], [right]) => left.localeCompare(right))
    return createHash("sha256").update(JSON.stringify(entries)).digest("hex")
  }

  async stamp(): Promise<string | undefined> {
    return fs
      .stat(this.cachePath)
      .then((value) => `${value.mtimeMs}:${value.ctimeMs}:${value.size}`)
      .catch(() => undefined)
  }
}
