import { describe, test, expect } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { v5 as uuidv5 } from "uuid"
import { CacheManager } from "../../../../src/indexing/cache-manager"
import { QDRANT_CODE_BLOCK_NAMESPACE } from "../../../../src/indexing/constants"
import type {
  IEmbedder,
  IndexingTelemetryEvent,
  IVectorStore,
  PointStruct,
  VectorStoreSearchResult,
} from "../../../../src/indexing/interfaces"
import { FileWatcher } from "../../../../src/indexing/processors/file-watcher"
import { loadIgnore } from "../../../../src/indexing/shared/load-ignore"

function createEmbedder(): IEmbedder {
  return {
    async createEmbeddings(texts) {
      return {
        embeddings: texts.map((_, index) => [index + 1]),
      }
    },
    async validateConfiguration() {
      return { valid: true }
    },
    get embedderInfo() {
      return { name: "openai" as const }
    },
  }
}

class RetryStore implements IVectorStore {
  constructor(private readonly fail: number) {}

  private calls = 0

  async initialize(): Promise<boolean> {
    return false
  }

  async upsertPoints(_points: PointStruct[]): Promise<void> {
    this.calls += 1
    if (this.calls <= this.fail) {
      throw new Error("watcher upsert failure for /tmp/watcher/path.ts")
    }
  }

  async search(
    _queryVector: number[],
    _directoryPrefix?: string,
    _minScore?: number,
    _maxResults?: number,
  ): Promise<VectorStoreSearchResult[]> {
    return []
  }

  async deletePointsByFilePath(_filePath: string): Promise<void> {}
  async deletePointsByMultipleFilePaths(_filePaths: string[]): Promise<void> {}
  async clearCollection(): Promise<void> {}
  async deleteCollection(): Promise<void> {}
  async collectionExists(): Promise<boolean> {
    return true
  }
  async hasIndexedData(): Promise<boolean> {
    return false
  }
  async markIndexingComplete(): Promise<void> {}
  async markIndexingIncomplete(): Promise<void> {}
}

describe("FileWatcher", () => {
  test("processFile preserves same-line segments during incremental updates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "oversized.md")
    const line = "x".repeat(5000)

    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, line)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const watcher = new FileWatcher(root, cache, createEmbedder())
    const result = await watcher.processFile(file)

    expect(result.status).toBe("processed_for_batching")
    expect(result.pointsToUpsert).toBeDefined()

    const points = result.pointsToUpsert!
    expect(points.length).toBe(5)

    const ids = points.map((point) => point.id)
    expect(new Set(ids).size).toBe(points.length)

    const hashes = points.map((point) => point.payload.segmentHash)
    expect(new Set(hashes).size).toBe(points.length)

    points.forEach((point) => {
      expect(point.payload.startLine).toBe(1)
      expect(point.payload.endLine).toBe(1)
      expect(point.id).toBe(uuidv5(point.payload.segmentHash, QDRANT_CODE_BLOCK_NAMESPACE))
    })
  })

  test("emits retry telemetry for watcher upsert retries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "oversized.md")
    const line = "x".repeat(5000)

    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, line)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const events: IndexingTelemetryEvent[] = []
    const watcher = new FileWatcher(
      root,
      cache,
      createEmbedder(),
      new RetryStore(1),
      undefined,
      1,
      2,
      (event) => events.push(event),
      {
        provider: "openai",
        vectorStore: "lancedb",
        modelId: "text-embedding-3-small",
      },
    )
    const data = watcher as unknown as {
      processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
    }

    await data.processBatch(
      new Map([
        [
          file,
          {
            path: file,
            type: "create",
          },
        ],
      ]),
    )

    const retry = events.find((event) => event.type === "batch_retry")
    expect(retry).toBeDefined()
    expect(retry?.type).toBe("batch_retry")
    expect(retry?.source).toBe("watcher")
    expect(retry?.attempt).toBe(1)
    expect(retry?.maxRetries).toBe(2)
    expect(retry?.error).toContain("[REDACTED_PATH]")
  })

  test("emits error telemetry when watcher retries are exhausted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "oversized.md")
    const line = "x".repeat(5000)

    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, line)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const events: IndexingTelemetryEvent[] = []
    const watcher = new FileWatcher(
      root,
      cache,
      createEmbedder(),
      new RetryStore(10),
      undefined,
      1,
      2,
      (event) => events.push(event),
      {
        provider: "openai",
        vectorStore: "lancedb",
        modelId: "text-embedding-3-small",
      },
    )
    const data = watcher as unknown as {
      processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
    }

    await data.processBatch(
      new Map([
        [
          file,
          {
            path: file,
            type: "create",
          },
        ],
      ]),
    )

    const error = events.find(
      (event): event is Extract<IndexingTelemetryEvent, { type: "error" }> =>
        event.type === "error" && event.location === "file-watcher:upsert_retry_exhausted",
    )
    expect(error).toBeDefined()
    expect(error?.type).toBe("error")
    expect(error?.source).toBe("watcher")
    expect(error?.mode).toBe("incremental")
    expect(error?.retryCount).toBe(2)
    expect(error?.error).toContain("[REDACTED_PATH]")
  })

  test("processFile skips files matched by .kilocodeignore during incremental updates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "secret.ts")

    await mkdir(cacheDir, { recursive: true })
    await writeFile(path.join(root, ".kilocodeignore"), "secret.ts\n")
    await writeFile(file, "export const secret = 1\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const watcher = new FileWatcher(root, cache, createEmbedder(), undefined, await loadIgnore(root))
    const result = await watcher.processFile(file)

    expect(result.status).toBe("skipped")
    expect(result.reason).toBe("File is ignored by .gitignore or .kilocodeignore")
  })
})
