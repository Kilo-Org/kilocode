import { createHash } from "crypto"
import { mkdir, mkdtemp, rm, stat } from "fs/promises"
import ignore from "ignore"
import { tmpdir } from "os"
import { join } from "path"
import { describe, expect, test } from "bun:test"
import { CacheManager } from "../../../../src/indexing/cache-manager"
import { MAX_FILE_SIZE_BYTES } from "../../../../src/indexing/constants"
import type {
  CodeBlock,
  ICodeParser,
  IEmbedder,
  IndexingTelemetryEvent,
  IVectorStore,
  PointStruct,
  VectorStoreSearchResult,
} from "../../../../src/indexing/interfaces"
import { loadIgnore } from "../../../../src/indexing/shared/load-ignore"
import { DirectoryScanner } from "../../../../src/indexing/processors/scanner"
import { captureProfiles } from "../profile-capture"

class Emb implements IEmbedder {
  public async createEmbeddings(texts: string[]): Promise<{ embeddings: number[][] }> {
    return {
      embeddings: texts.map(() => [0.1]),
    }
  }

  public async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    return { valid: true }
  }

  public get embedderInfo() {
    return { name: "openai" as const }
  }
}

class Parser implements ICodeParser {
  public async parseFile(
    filePath: string,
    options?: {
      minBlockLines?: number
      maxBlockLines?: number
      content?: string
      fileHash?: string
    },
  ): Promise<CodeBlock[]> {
    return [
      {
        file_path: filePath,
        identifier: null,
        type: "definition.function",
        start_line: 1,
        end_line: 1,
        content: "export const x = 1",
        fileHash: options?.fileHash ?? "",
        segmentHash: `${filePath}:1:1`,
      },
    ]
  }
}

class ManyParser implements ICodeParser {
  public async parseFile(
    filePath: string,
    options?: {
      minBlockLines?: number
      maxBlockLines?: number
      content?: string
      fileHash?: string
    },
  ): Promise<CodeBlock[]> {
    return [
      {
        file_path: filePath,
        identifier: null,
        type: "definition.function",
        start_line: 1,
        end_line: 1,
        content: "export const a = 1",
        fileHash: options?.fileHash ?? "",
        segmentHash: `${filePath}:1:1`,
      },
      {
        file_path: filePath,
        identifier: null,
        type: "definition.function",
        start_line: 2,
        end_line: 2,
        content: "export const b = 2",
        fileHash: options?.fileHash ?? "",
        segmentHash: `${filePath}:2:2`,
      },
      {
        file_path: filePath,
        identifier: null,
        type: "definition.function",
        start_line: 3,
        end_line: 3,
        content: "export const c = 3",
        fileHash: options?.fileHash ?? "",
        segmentHash: `${filePath}:3:3`,
      },
    ]
  }
}

class Store implements IVectorStore {
  public multi: string[][] = []
  public single: string[] = []
  public points = 0

  public async initialize(): Promise<boolean> {
    return false
  }

  public async upsertPoints(points: PointStruct[]): Promise<void> {
    this.points += points.length
  }

  public async search(
    _queryVector: number[],
    _directoryPrefix?: string,
    _minScore?: number,
    _maxResults?: number,
  ): Promise<VectorStoreSearchResult[]> {
    return []
  }

  public async deletePointsByFilePath(filePath: string): Promise<void> {
    this.single.push(filePath)
  }

  public async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
    this.multi.push(filePaths)
  }

  public async clearCollection(): Promise<void> {}

  public async deleteCollection(): Promise<void> {}

  public async collectionExists(): Promise<boolean> {
    return true
  }

  public async hasIndexedData(): Promise<boolean> {
    return false
  }

  public async markIndexingComplete(): Promise<void> {}

  public async markIndexingIncomplete(): Promise<void> {}
}

class FailStore extends Store {
  private calls = 0

  public override async upsertPoints(points: PointStruct[]): Promise<void> {
    this.calls++
    if (this.calls === 2) {
      throw new Error("upsert failed")
    }
    await super.upsertPoints(points)
  }
}

class RetryStore extends Store {
  private calls = 0

  public override async upsertPoints(points: PointStruct[]): Promise<void> {
    this.calls += 1
    if (this.calls === 1) {
      throw new Error("temporary upsert failure for /tmp/retry/path.ts")
    }
    await super.upsertPoints(points)
  }
}

class ExhaustedStore extends Store {
  public override async upsertPoints(_points: PointStruct[]): Promise<void> {
    throw new Error("permanent upsert failure")
  }
}

class CancellingEmb extends Emb {
  public onCreate?: () => void

  public override async createEmbeddings(texts: string[]): Promise<{ embeddings: number[][] }> {
    this.onCreate?.()
    return super.createEmbeddings(texts)
  }
}

class BlockingEmb extends Emb {
  public readonly started = Promise.withResolvers<void>()
  private readonly gate = Promise.withResolvers<void>()

  public override async createEmbeddings(texts: string[]): Promise<{ embeddings: number[][] }> {
    this.started.resolve()
    await this.gate.promise
    return super.createEmbeddings(texts)
  }

  public release(): void {
    this.gate.resolve()
  }
}

describe("DirectoryScanner", () => {
  test.serial("profiles aggregate scanner discovery, summary, and batches without file data", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-profile-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const supported = join(root, "supported.ts")
    const unsupported = join(root, "unsupported.txt")
    const unchanged = join(root, "unchanged.ts")
    const changed = join(root, "changed.ts")
    const oversized = join(root, "oversized.ts")
    const deleted = join(root, "deleted.ts")
    const unchangedContent = "export const unchanged = 1\n"

    try {
      await Bun.write(supported, "export const supported = 1\n")
      await Bun.write(unsupported, "unsupported\n")
      await Bun.write(unchanged, unchangedContent)
      await Bun.write(changed, "export const changed = 1\n")
      await Bun.write(oversized, Buffer.alloc(MAX_FILE_SIZE_BYTES + 1))

      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      cache.seedHashes({
        [unchanged]: createHash("sha256").update(unchangedContent).digest("hex"),
        [changed]: "old-hash",
        [deleted]: "deleted-hash",
      })

      const scan = new DirectoryScanner(
        new Emb(),
        new Store(),
        new Parser(),
        cache,
        ignore(),
        1,
        1,
        undefined,
        {
          provider: "openai",
          vectorStore: "lancedb",
          modelId: "text-embedding-3-small",
        },
      )
      const records = await captureProfiles(async () => {
        await scan.scanDirectory(root)
      })
      const discovery = records.filter((item) => item.event === "indexing.scan.discovery")
      const summary = records.filter((item) => item.event === "indexing.scan.summary")
      const batches = records.filter((item) => item.event === "indexing.scan.batch")

      expect(discovery).toHaveLength(1)
      expect(discovery[0]?.outcome).toBe("success")
      expect(discovery[0]?.fields).toEqual({
        mode: "full",
        discoveredCount: 4,
        candidateCount: 4,
      })

      expect(summary).toHaveLength(1)
      expect(summary[0]?.outcome).toBe("success")
      expect(summary[0]?.fields).toEqual({
        mode: "full",
        discoveredCount: 4,
        candidateCount: 4,
        inspectedCount: 4,
        readCount: 3,
        bytesRead: expect.any(Number),
        unchangedCount: 1,
        processedCount: 2,
        skippedCount: 2,
        blockCount: 2,
        batchCount: 2,
        changedDeleteCount: 1,
        removedDeleteCount: 1,
      })
      expect(summary[0]?.fields.bytesRead).toBeGreaterThan(0)
      expect(summary[0]?.fields.unchangedCount).toBe(1)

      expect(batches).toHaveLength(2)
      for (const batch of batches) {
        expect(batch.outcome).toBe("success")
        expect(batch.fields).toEqual({
          source: "scan",
          mode: "full",
          provider: "openai",
          modelId: "text-embedding-3-small",
          vectorStore: "lancedb",
          fileCount: 1,
          blockCount: 1,
          attemptCount: 1,
          deleteMs: expect.any(Number),
          embeddingMs: expect.any(Number),
          upsertMs: expect.any(Number),
        })
        expect(batch.fields.blockCount).toBe(1)
        expect(batch.fields.attemptCount).toBe(1)
      }
      expect(JSON.stringify(records)).not.toContain(root)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test.serial("profiles retry attempts as one terminal batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-profile-retry-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))

    try {
      await Bun.write(join(root, "main.ts"), "export const value = 2\n")
      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const scan = new DirectoryScanner(
        new Emb(),
        new RetryStore(),
        new Parser(),
        cache,
        ignore(),
        1,
        2,
        undefined,
        {
          provider: "openai",
          vectorStore: "lancedb",
          modelId: "text-embedding-3-small",
        },
      )
      const records = await captureProfiles(async () => {
        await scan.scanDirectory(root)
      })
      const batches = records.filter((item) => item.event === "indexing.scan.batch")

      expect(batches).toHaveLength(1)
      expect(batches[0]?.outcome).toBe("success")
      expect(batches[0]?.fields).toEqual({
        source: "scan",
        mode: "full",
        provider: "openai",
        modelId: "text-embedding-3-small",
        vectorStore: "lancedb",
        fileCount: 1,
        blockCount: 1,
        attemptCount: 2,
        deleteMs: expect.any(Number),
        embeddingMs: expect.any(Number),
        upsertMs: expect.any(Number),
      })
      expect(JSON.stringify(batches)).not.toContain(root)
      expect(JSON.stringify(batches)).not.toContain("temporary upsert failure")
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test.serial("profiles exhausted retry batches without source data", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-profile-exhausted-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))

    try {
      await Bun.write(join(root, "main.ts"), "export const value = 2\n")
      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const scan = new DirectoryScanner(
        new Emb(),
        new ExhaustedStore(),
        new Parser(),
        cache,
        ignore(),
        1,
        2,
        undefined,
        {
          provider: "openai",
          vectorStore: "lancedb",
          modelId: "text-embedding-3-small",
        },
      )
      const records = await captureProfiles(async () => {
        await scan.scanDirectory(root)
      })
      const batches = records.filter((item) => item.event === "indexing.scan.batch")

      expect(batches).toHaveLength(1)
      expect(batches[0]?.outcome).toBe("error")
      expect(batches[0]?.fields).toEqual({
        source: "scan",
        mode: "full",
        provider: "openai",
        modelId: "text-embedding-3-small",
        vectorStore: "lancedb",
        fileCount: 1,
        blockCount: 1,
        attemptCount: 2,
        deleteMs: expect.any(Number),
        embeddingMs: expect.any(Number),
        upsertMs: expect.any(Number),
      })
      expect(JSON.stringify(batches)).not.toContain(root)
      expect(JSON.stringify(batches)).not.toContain("permanent upsert failure")
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test.serial("profiles cooperative scanner cancellation", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-profile-cancelled-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))

    try {
      await Bun.write(join(root, "main.ts"), "export const value = 2\n")
      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const emb = new CancellingEmb()
      const scan = new DirectoryScanner(
        emb,
        new Store(),
        new Parser(),
        cache,
        ignore(),
        1,
        1,
        undefined,
        {
          provider: "openai",
          vectorStore: "lancedb",
          modelId: "text-embedding-3-small",
        },
      )
      emb.onCreate = () => scan.cancel()

      const records = await captureProfiles(async () => {
        await scan.scanDirectory(root)
        await new Promise<void>((resolve) => setImmediate(resolve))
      })
      const summary = records.find((item) => item.event === "indexing.scan.summary")
      const batches = records.filter((item) => item.event === "indexing.scan.batch")

      expect(summary?.outcome).toBe("cancelled")
      expect(summary?.fields.processedCount).toBe(1)
      expect(summary?.fields.batchCount).toBe(1)
      expect(batches).toHaveLength(1)
      expect(batches[0]?.outcome).toBe("cancelled")
      expect(batches[0]?.fields.blockCount).toBe(1)
      expect(batches[0]?.fields.attemptCount).toBe(1)
      expect(JSON.stringify(records)).not.toContain(root)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test.serial("profiles cancellation requested while batches settle", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-profile-settling-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const emb = new BlockingEmb()

    try {
      await Bun.write(join(root, "main.ts"), "export const value = 2\n")
      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const scan = new DirectoryScanner(
        emb,
        new Store(),
        new Parser(),
        cache,
        ignore(),
        1,
        1,
        undefined,
        {
          provider: "openai",
          vectorStore: "lancedb",
          modelId: "text-embedding-3-small",
        },
      )

      const records = await captureProfiles(async () => {
        const task = scan.scanDirectory(root)
        await emb.started.promise
        // RATIONALE: Keep the batch pending until scanDirectory is waiting for active batches.
        await new Promise<void>((resolve) => setImmediate(resolve))
        scan.cancel()
        emb.release()
        await task
      })
      const summary = records.find((item) => item.event === "indexing.scan.summary")

      expect(summary?.outcome).toBe("cancelled")
    } finally {
      emb.release()
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("uses seeded baseline hashes to index only worktree changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const same = join(root, "same.ts")
    const changed = join(root, "changed.ts")
    const added = join(root, "added.ts")
    const deleted = join(root, "deleted.ts")
    const sameContent = "export const same = 1\n"
    const changedContent = "export const changed = 2\n"

    await Bun.write(same, sameContent)
    await Bun.write(changed, changedContent)
    await Bun.write(added, "export const added = 1\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.seedHashes({
      [same]: createHash("sha256").update(sameContent).digest("hex"),
      [changed]: "baseline-changed",
      [deleted]: "baseline-deleted",
    })

    const store = new Store()
    const scan = new DirectoryScanner(new Emb(), store, new Parser(), cache, ignore(), 1, 1)
    const result = await scan.scanDirectory(root)

    expect(result.stats.processed).toBe(2)
    expect(store.points).toBe(2)
    expect(cache.getHash(same)).toBe(createHash("sha256").update(sameContent).digest("hex"))
    expect(cache.getHash(changed)).toBe(createHash("sha256").update(changedContent).digest("hex"))
    expect(cache.getHash(added)).toBeDefined()
    expect(cache.getHash(deleted)).toBeUndefined()
  })

  test("keeps file metadata when threshold flush is triggered by that file", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    const content = "export const value = 2\n"
    await Bun.write(file, content)

    const hash = createHash("sha256").update(content).digest("hex")
    const info = await stat(file)
    const metadata = { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs }
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.updateHash(file, "old-hash")

    const emb = new Emb()
    const parser = new Parser()
    const store = new Store()
    const scan = new DirectoryScanner(emb, store, parser, cache, ignore(), 1, 1)

    const result = await scan.scanDirectory(root)

    expect(result.stats.processed).toBe(1)
    expect(store.points).toBe(1)
    expect(store.multi).toEqual([[file]])
    expect(cache.getHash(file)).toBe(hash)
    expect(cache.getMetadata(file)).toEqual(metadata)
  })

  test("does not mark hash current when a later batch fails for the same file", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    const content = "export const value = 2\n"
    await Bun.write(file, content)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.updateHash(file, "old-hash")

    const emb = new Emb()
    const parser = new ManyParser()
    const store = new FailStore()
    const scan = new DirectoryScanner(emb, store, parser, cache, ignore(), 2, 1)

    await scan.scanDirectory(root)

    expect(cache.getHash(file)).toBe("old-hash")
  })

  test("emits candidate counts for scan telemetry", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    await Bun.write(file, "export const value = 2\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const events: IndexingTelemetryEvent[] = []
    const scan = new DirectoryScanner(
      new Emb(),
      new Store(),
      new Parser(),
      cache,
      ignore(),
      1,
      1,
      (event) => events.push(event),
      {
        provider: "openai",
        vectorStore: "lancedb",
        modelId: "text-embedding-3-small",
      },
    )

    await scan.scanDirectory(root, undefined, undefined, undefined, "full")

    const count = events.find((event) => event.type === "file_count")
    expect(count).toBeDefined()
    expect(count?.type).toBe("file_count")
    expect(count?.mode).toBe("full")
    expect(count?.source).toBe("scan")
    expect(count?.candidate).toBe(1)
  })

  test("discovers uppercase configured extensions without unsupported files", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))

    try {
      await Bun.write(join(root, "main.TS"), "export const value = 2\n")
      await Bun.write(join(root, "notes.txt"), "unsupported\n")

      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const events: IndexingTelemetryEvent[] = []
      const scan = new DirectoryScanner(
        new Emb(),
        new Store(),
        new Parser(),
        cache,
        ignore(),
        1,
        1,
        (event) => events.push(event),
        {
          provider: "openai",
          vectorStore: "lancedb",
          modelId: "text-embedding-3-small",
        },
        [".ts"],
      )

      const result = await scan.scanDirectory(root)
      const count = events.find((event) => event.type === "file_count")

      expect(result.stats.processed).toBe(1)
      expect(count?.type).toBe("file_count")
      expect(count?.discovered).toBe(1)
      expect(count?.candidate).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test.serial("skips incremental reads when cached metadata matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    const content = "export const value = 2\n"

    try {
      await Bun.write(file, content)
      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const info = await stat(file)
      const metadata = { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs }
      const hash = createHash("sha256").update(content).digest("hex")
      cache.updateHash(file, hash, metadata)

      const store = new Store()
      const scan = new DirectoryScanner(new Emb(), store, new Parser(), cache, ignore(), 1, 1)
      const results: { stats: { processed: number; skipped: number }; totalBlockCount: number }[] = []
      const incremental = await captureProfiles(() =>
        scan
          .scanDirectory(root, undefined, undefined, undefined, "incremental")
          .then((result) => void results.push(result)),
      )
      const [result] = results
      const first = incremental.find((item) => item.event === "indexing.scan.summary")

      expect(result).toEqual({ stats: { processed: 0, skipped: 1 }, totalBlockCount: 0 })
      expect(first?.fields.readCount).toBe(0)
      expect(first?.fields.bytesRead).toBe(0)
      expect(first?.fields.unchangedCount).toBe(1)
      expect(store.points).toBe(0)
      expect(store.multi).toEqual([])
      expect(store.single).toEqual([])
      expect(cache.getHash(file)).toBe(hash)

      const full = await captureProfiles(() =>
        scan.scanDirectory(root, undefined, undefined, undefined, "full").then(() => undefined),
      )
      expect(full.find((item) => item.event === "indexing.scan.summary")?.fields.readCount).toBe(1)

      cache.updateHash(file, cache.getHash(file)!, { ...metadata, mtimeMs: metadata.mtimeMs - 1 })
      const fallback = await captureProfiles(() =>
        scan.scanDirectory(root, undefined, undefined, undefined, "incremental").then(() => undefined),
      )
      expect(fallback.find((item) => item.event === "indexing.scan.summary")?.fields.readCount).toBe(1)
      expect(cache.getMetadata(file)).toEqual(metadata)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("skips files matched by .kilocodeignore during full scans", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const blocked = join(root, "blocked.ts")
    const open = join(root, "open.ts")

    await Bun.write(join(root, ".kilocodeignore"), "blocked.ts\n")
    await Bun.write(blocked, "export const blocked = 1\n")
    await Bun.write(open, "export const open = 1\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const scan = new DirectoryScanner(new Emb(), new Store(), new Parser(), cache, await loadIgnore(root), 1, 1)
    const result = await scan.scanDirectory(root)

    expect(result.stats.processed).toBe(1)
    expect(cache.getHash(blocked)).toBeUndefined()
    expect(cache.getHash(open)).toBeDefined()
  })

  test("uses a configured extension allowlist and removes excluded cached files", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const custom = join(root, "main.custom")
    const excluded = join(root, "main.ts")
    await Bun.write(custom, "custom source content\n")
    await Bun.write(excluded, "export const excluded = 1\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.updateHash(excluded, "old-hash")
    const scan = new DirectoryScanner(
      new Emb(),
      new Store(),
      new Parser(),
      cache,
      ignore(),
      1,
      1,
      undefined,
      undefined,
      [".custom"],
    )

    const result = await scan.scanDirectory(root)

    expect(result.stats.processed).toBe(1)
    expect(cache.getHash(custom)).toBeDefined()
    expect(cache.getHash(excluded)).toBeUndefined()
  })

  test("skips binary files admitted by a custom extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "data.custom")
    await Bun.write(file, new Uint8Array([0, 1, 2, 3]))
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const scan = new DirectoryScanner(
      new Emb(),
      new Store(),
      new Parser(),
      cache,
      ignore(),
      1,
      1,
      undefined,
      undefined,
      [".custom"],
    )

    const result = await scan.scanDirectory(root)

    expect(result.stats).toEqual({ processed: 0, skipped: 1 })
    expect(cache.getHash(file)).toBeUndefined()
  })

  test("skips files matched by nested .kilocodeignore during full scans", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    try {
      const dir = join(root, "pkg")
      const blocked = join(dir, "blocked.ts")
      const open = join(dir, "open.ts")

      await mkdir(dir, { recursive: true })
      await Bun.write(join(dir, ".kilocodeignore"), "blocked.ts\n")
      await Bun.write(blocked, "export const blocked = 1\n")
      await Bun.write(open, "export const open = 1\n")

      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()

      const scan = new DirectoryScanner(new Emb(), new Store(), new Parser(), cache, await loadIgnore(root), 1, 1)
      const result = await scan.scanDirectory(root)

      expect(result.stats.processed).toBe(1)
      expect(cache.getHash(blocked)).toBeUndefined()
      expect(cache.getHash(open)).toBeDefined()
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("emits retry telemetry for transient batch failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    await Bun.write(file, "export const value = 2\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const events: IndexingTelemetryEvent[] = []
    const scan = new DirectoryScanner(
      new Emb(),
      new RetryStore(),
      new Parser(),
      cache,
      ignore(),
      1,
      2,
      (event) => events.push(event),
      {
        provider: "openai",
        vectorStore: "lancedb",
        modelId: "text-embedding-3-small",
      },
    )

    await scan.scanDirectory(root, undefined, undefined, undefined, "full")

    const retry = events.find((event) => event.type === "batch_retry")
    expect(retry).toBeDefined()
    expect(retry?.type).toBe("batch_retry")
    expect(retry?.source).toBe("scan")
    expect(retry?.attempt).toBe(1)
    expect(retry?.maxRetries).toBe(2)
    expect(retry?.error).toContain("[REDACTED_PATH]")
  })
})
