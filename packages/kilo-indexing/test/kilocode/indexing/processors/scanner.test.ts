import { createHash } from "crypto"
import { mkdtemp } from "fs/promises"
import ignore from "ignore"
import { tmpdir } from "os"
import { join } from "path"
import { describe, expect, test } from "bun:test"
import { CacheManager } from "../../../../src/indexing/cache-manager"
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

class CountEmb extends Emb {
  public calls = 0

  public override async createEmbeddings(texts: string[]): Promise<{ embeddings: number[][] }> {
    this.calls += 1
    return super.createEmbeddings(texts)
  }
}

class FailEmb extends Emb {
  public override async createEmbeddings(_texts: string[]): Promise<{ embeddings: number[][] }> {
    throw new Error("embedding failed")
  }
}

class TrackEmb extends Emb {
  public active = 0
  public max = 0

  public override async createEmbeddings(texts: string[]): Promise<{ embeddings: number[][] }> {
    this.active += 1
    this.max = Math.max(this.max, this.active)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const result = await super.createEmbeddings(texts)
    this.active -= 1
    return result
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

  public async deletePointsByFilePath(_filePath: string): Promise<void> {}

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

describe("DirectoryScanner", () => {
  test("keeps file metadata when threshold flush is triggered by that file", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    const content = "export const value = 2\n"
    await Bun.write(file, content)

    const hash = createHash("sha256").update(content).digest("hex")
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
  })

  test("serializes embedding requests across queued scan batches", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    await Bun.write(file, "export const value = 2\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const emb = new TrackEmb()
    const store = new Store()
    const scan = new DirectoryScanner(emb, store, new ManyParser(), cache, ignore(), 1, 1)

    await scan.scanDirectory(root)

    expect(store.points).toBe(3)
    expect(emb.max).toBe(1)
  })

  test("keeps prior vectors when replacement embeddings fail", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    await Bun.write(file, "export const value = 2\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.updateHash(file, "old-hash")

    const errors: Error[] = []
    const store = new Store()
    const scan = new DirectoryScanner(new FailEmb(), store, new Parser(), cache, ignore(), 1, 2)

    await scan.scanDirectory(root, (error) => errors.push(error))

    expect(errors).toHaveLength(1)
    expect(store.multi).toEqual([])
    expect(cache.getHash(file)).toBe("old-hash")
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

  test("emits retry telemetry for transient batch failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    await Bun.write(file, "export const value = 2\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const events: IndexingTelemetryEvent[] = []
    const emb = new CountEmb()
    const scan = new DirectoryScanner(
      emb,
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
    expect(emb.calls).toBe(1)
  })
})
