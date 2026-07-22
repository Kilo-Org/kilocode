import { describe, test, expect } from "bun:test"
import { mkdtemp, mkdir, rm, stat, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { createHash } from "crypto"
import { v5 as uuidv5 } from "uuid"
import { CacheManager } from "../../../../src/indexing/cache-manager"
import { QDRANT_CODE_BLOCK_NAMESPACE } from "../../../../src/indexing/constants"
import type {
  CodeBlock,
  ICodeParser,
  IEmbedder,
  IndexingTelemetryEvent,
  IVectorStore,
  PointStruct,
  VectorStoreSearchResult,
} from "../../../../src/indexing/interfaces"
import { FileWatcher } from "../../../../src/indexing/processors/file-watcher"
import { CodeParser } from "../../../../src/indexing/processors/parser"
import { loadIgnore } from "../../../../src/indexing/shared/load-ignore"
import { WorktreeOverlay } from "../../../../src/indexing/worktree-overlay"
import { captureProfiles } from "../profile-capture"

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

function createWrongCountEmbedder(): IEmbedder {
  return {
    async createEmbeddings() {
      return { embeddings: [] }
    },
    async validateConfiguration() {
      return { valid: true }
    },
    get embedderInfo() {
      return { name: "openai" as const }
    },
  }
}

function createParser(): ICodeParser {
  return {
    async parseFile(filePath, options): Promise<CodeBlock[]> {
      return [
        {
          file_path: filePath,
          identifier: null,
          type: "definition",
          start_line: 1,
          end_line: 1,
          content: "const indexed = true",
          fileHash: options?.fileHash ?? "",
          segmentHash: "segment",
        },
      ]
    },
  }
}

class RetryStore implements IVectorStore {
  public readonly points: PointStruct[] = []

  constructor(private readonly fail: number) {}

  private calls = 0

  async initialize(): Promise<boolean> {
    return false
  }

  async upsertPoints(points: PointStruct[]): Promise<void> {
    this.calls += 1
    if (this.calls <= this.fail) {
      throw new Error("watcher upsert failure for /tmp/watcher/path.ts")
    }
    this.points.push(...points)
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
  test.serial("profiles watcher batches and per-file embeddings without source data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-profile-"))
    const cacheDir = path.join(root, ".cache")
    const first = path.join(root, "first.ts")
    const second = path.join(root, "second.ts")

    try {
      await mkdir(cacheDir, { recursive: true })
      await writeFile(first, "const watcherSecret = 'sensitive-file-code'\n")
      await writeFile(second, "const watcherSecret = 'sensitive-file-code'\n")
      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const watcher = new FileWatcher(
        root,
        cache,
        createEmbedder(),
        new RetryStore(1),
        undefined,
        1,
        2,
        undefined,
        {
          provider: "openai",
          vectorStore: "lancedb",
          modelId: "text-embedding-3-small",
        },
        [".ts"],
        createParser(),
      )
      const data = watcher as unknown as {
        processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
      }

      const records = await captureProfiles(async () => {
        await data.processBatch(
          new Map([
            [first, { path: first, type: "create" }],
            [second, { path: second, type: "create" }],
          ]),
        )
      })
      const batches = records.filter((item) => item.event === "indexing.watcher.batch")
      const embeddings = records.filter((item) => item.event === "indexing.watcher.embedding")
      expect(batches).toHaveLength(1)
      const batch = batches[0]

      expect(batch?.outcome).toBe("success")
      expect(batch?.fields).toEqual({
        source: "watcher",
        mode: "incremental",
        provider: "openai",
        modelId: "text-embedding-3-small",
        vectorStore: "lancedb",
        eventCount: 2,
        deleteCount: 0,
        upsertFileCount: 2,
        pointCount: 2,
        successCount: 2,
        skippedCount: 0,
        errorCount: 0,
        deleteMs: expect.any(Number),
        prepareMs: expect.any(Number),
        upsertMs: expect.any(Number),
        flushMs: expect.any(Number),
      })
      expect(embeddings).toHaveLength(2)
      for (const embedding of embeddings) {
        expect(embedding.outcome).toBe("success")
        expect(embedding.fields).toEqual({
          provider: "openai",
          modelId: "text-embedding-3-small",
          textCount: 1,
        })
      }
      expect(JSON.stringify(records)).not.toContain(root)
      expect(JSON.stringify(records)).not.toContain(first)
      expect(JSON.stringify(records)).not.toContain("sensitive-file-code")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test.serial("profiles watcher batch errors without source data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-profile-error-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "error.ts")

    try {
      await mkdir(cacheDir, { recursive: true })
      await writeFile(file, "const watcherSecret = 'sensitive-file-code'\n")
      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const watcher = new FileWatcher(
        root,
        cache,
        createEmbedder(),
        new RetryStore(10),
        undefined,
        1,
        2,
        undefined,
        {
          provider: "openai",
          vectorStore: "lancedb",
          modelId: "text-embedding-3-small",
        },
        [".ts"],
        createParser(),
      )
      const data = watcher as unknown as {
        processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
      }

      const records = await captureProfiles(async () => {
        await data.processBatch(new Map([[file, { path: file, type: "create" }]]))
      })
      const batches = records.filter((item) => item.event === "indexing.watcher.batch")
      expect(batches).toHaveLength(1)
      const batch = batches[0]

      expect(batch?.outcome).toBe("error")
      expect(batch?.fields).toEqual({
        source: "watcher",
        mode: "incremental",
        provider: "openai",
        modelId: "text-embedding-3-small",
        vectorStore: "lancedb",
        eventCount: 1,
        deleteCount: 0,
        upsertFileCount: 1,
        pointCount: 1,
        successCount: 0,
        skippedCount: 0,
        errorCount: 1,
        deleteMs: expect.any(Number),
        prepareMs: expect.any(Number),
        upsertMs: expect.any(Number),
        flushMs: expect.any(Number),
      })
      expect(JSON.stringify(records)).not.toContain(root)
      expect(JSON.stringify(records)).not.toContain(file)
      expect(JSON.stringify(records)).not.toContain("watcher upsert failure")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test.serial("profiles wrong-count watcher embeddings as errors without source data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-profile-embedding-error-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "error.ts")

    try {
      await mkdir(cacheDir, { recursive: true })
      await writeFile(file, "const watcherSecret = 'sensitive-file-code'\n")
      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const watcher = new FileWatcher(
        root,
        cache,
        createWrongCountEmbedder(),
        new RetryStore(0),
        undefined,
        1,
        2,
        undefined,
        {
          provider: "openai",
          vectorStore: "lancedb",
          modelId: "text-embedding-3-small",
        },
        [".ts"],
        createParser(),
      )
      const data = watcher as unknown as {
        processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
      }

      const records = await captureProfiles(async () => {
        await data.processBatch(new Map([[file, { path: file, type: "create" }]]))
      })
      const batches = records.filter((item) => item.event === "indexing.watcher.batch")
      const embeddings = records.filter((item) => item.event === "indexing.watcher.embedding")
      expect(batches).toHaveLength(1)
      expect(embeddings).toHaveLength(1)
      const batch = batches[0]
      const embedding = embeddings[0]

      expect(batch?.outcome).toBe("error")
      expect(batch?.fields).toEqual({
        source: "watcher",
        mode: "incremental",
        provider: "openai",
        modelId: "text-embedding-3-small",
        vectorStore: "lancedb",
        eventCount: 1,
        deleteCount: 0,
        upsertFileCount: 1,
        pointCount: 0,
        successCount: 0,
        skippedCount: 0,
        errorCount: 1,
        deleteMs: expect.any(Number),
        prepareMs: expect.any(Number),
        upsertMs: expect.any(Number),
        flushMs: expect.any(Number),
      })
      expect(embedding?.outcome).toBe("error")
      expect(embedding?.fields).toEqual({
        provider: "openai",
        modelId: "text-embedding-3-small",
        textCount: 1,
      })
      expect(JSON.stringify(records)).not.toContain(root)
      expect(JSON.stringify(records)).not.toContain(file)
      expect(JSON.stringify(records)).not.toContain("sensitive-file-code")
      expect(JSON.stringify(records)).not.toContain("Embedding count mismatch")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

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

  test("updates worktree shadows when a baseline file changes and reverts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "file.ts")
    const baseline = "export const baseline = '" + "x".repeat(100) + "'\n"
    const changed = "export const changed = '" + "y".repeat(100) + "'\n"
    const baselineHash = createHash("sha256").update(baseline).digest("hex")

    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, changed)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.seedHashes({ [file]: baselineHash })
    const overlay = new WorktreeOverlay(root, path.join(root, "baseline"), new Map([["file.ts", baselineHash]]))
    const store = new RetryStore(0)
    const watcher = new FileWatcher(root, cache, createEmbedder(), store)
    watcher.setOverlay(overlay)
    const data = watcher as unknown as {
      processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
    }

    overlay.block(file)
    await data.processBatch(new Map([[file, { path: file, type: "change" }]]))

    expect(overlay.shadows.has("file.ts")).toBe(true)
    expect(overlay.blocked.has("file.ts")).toBe(false)
    expect(cache.getHash(file)).toBe(createHash("sha256").update(changed).digest("hex"))
    const info = await stat(file)
    expect(cache.getMetadata(file)).toEqual({
      size: info.size,
      mtimeMs: info.mtimeMs,
      ctimeMs: info.ctimeMs,
    })

    await writeFile(file, baseline)
    overlay.block(file)
    await data.processBatch(new Map([[file, { path: file, type: "change" }]]))

    expect(overlay.shadows.has("file.ts")).toBe(false)
    expect(overlay.blocked.has("file.ts")).toBe(false)
    expect(cache.getHash(file)).toBe(baselineHash)
    expect(cache.getMetadata(file)).toBeUndefined()
    expect(store.points.length).toBeGreaterThan(0)
    const count = store.points.length

    await writeFile(file, changed)
    overlay.block(file)
    await data.processBatch(new Map([[file, { path: file, type: "change" }]]))
    await writeFile(file, baseline)
    overlay.block(file)
    await data.processBatch(new Map([[file, { path: file, type: "change" }]]))

    expect(store.points).toHaveLength(count * 2)
  })

  test("reports unexpected drain failures for recovery", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "file.ts")
    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, "export const value = '" + "x".repeat(100) + "'\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.flush = async () => {
      throw new Error("cache flush failed")
    }
    const watcher = new FileWatcher(root, cache, createEmbedder(), new RetryStore(0))
    const summary = new Promise<{ batchError?: Error }>((resolve) => {
      watcher.onDidFinishBatchProcessing.on(resolve)
    })
    const data = watcher as unknown as {
      handleFileEvent(filePath: string, type: "create" | "change" | "delete"): void
    }

    watcher.setCollecting(true)
    data.handleFileEvent(file, "create")
    const result = await Promise.race([
      summary,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("watcher did not report failure")), 2000)),
    ])

    expect(result.batchError?.message).toBe("cache flush failed")
    await watcher.shutdown()
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

  test("processFile uses the configured extension allowlist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const custom = path.join(root, "source.custom")
    const excluded = path.join(root, "source.ts")
    const content = "custom source content ".repeat(20)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(custom, content)
    await writeFile(excluded, content)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const watcher = new FileWatcher(
      root,
      cache,
      createEmbedder(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [".custom"],
      new CodeParser([".custom"]),
    )

    const first = await watcher.processFile(custom)
    expect(first.status).toBe("processed_for_batching")
    if (first.status === "processed_for_batching" && first.newHash) {
      expect(first.metadata).toBeDefined()
      cache.updateHash(custom, first.newHash, first.metadata)
    }
    expect(await watcher.processFile(excluded)).toMatchObject({
      status: "skipped",
      reason: "File extension is not configured for indexing",
    })
    await writeFile(custom, new Uint8Array([0, 1, 2, 3]))
    expect(await watcher.processFile(custom)).toMatchObject({ status: "skipped", reason: "File is binary" })
    expect(cache.getHash(custom)).toBeUndefined()
    await writeFile(custom, content)
    expect((await watcher.processFile(custom)).status).toBe("processed_for_batching")
  })

  test("processFile skips files matched by nested .gitignore during incremental updates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    try {
      const cacheDir = path.join(root, ".cache")
      const dir = path.join(root, "pkg")
      const file = path.join(dir, "secret.ts")

      await mkdir(cacheDir, { recursive: true })
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, ".gitignore"), "secret.ts\n")
      await writeFile(file, "export const secret = 1\n")

      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()

      const watcher = new FileWatcher(root, cache, createEmbedder(), undefined, await loadIgnore(root))
      const result = await watcher.processFile(file)

      expect(result.status).toBe("skipped")
      expect(result.reason).toBe("File is ignored by .gitignore or .kilocodeignore")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
