import { createHash } from "crypto"
import { mkdir, mkdtemp, rm } from "fs/promises"
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
import { DirectoryScanner, RejectedChunkError } from "../../../../src/indexing/processors/scanner"

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

/** Embedder that, like a provider with a small context window, answers 400 for any input over the limit. */
class LimitEmb implements IEmbedder {
  public calls: string[][] = []

  constructor(private readonly limit: number) {}

  public async createEmbeddings(texts: string[]): Promise<{ embeddings: number[][] }> {
    this.calls.push(texts)
    if (texts.some((text) => text.length > this.limit)) {
      throw Object.assign(new Error("Embedding request failed after 3 attempts with status 400: input too large"), {
        status: 400,
      })
    }
    return { embeddings: texts.map(() => [0.1]) }
  }

  public async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    return { valid: true }
  }

  public get embedderInfo() {
    return { name: "openai" as const }
  }
}

class SizedParser implements ICodeParser {
  public async parseFile(filePath: string, options?: { content?: string; fileHash?: string }): Promise<CodeBlock[]> {
    return (options?.content ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line, index) => ({
        file_path: filePath,
        identifier: null,
        type: "definition.function",
        start_line: index + 1,
        end_line: index + 1,
        content: line,
        fileHash: options?.fileHash ?? "",
        segmentHash: `${filePath}:${index}`,
      }))
  }
}

class RecordStore extends Store {
  public chunks: string[] = []

  public override async upsertPoints(points: PointStruct[]): Promise<void> {
    this.chunks.push(...points.map((point) => point.payload.codeChunk))
    await super.upsertPoints(points)
  }
}

class DeleteStore extends RecordStore {
  public removed: string[] = []

  public override async deletePointsByFilePath(filePath: string): Promise<void> {
    this.removed.push(filePath)
  }
}

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
  const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
  for (const [name, content] of Object.entries(files)) await Bun.write(join(root, name), content)
  const cache = new CacheManager(cacheDir, root)
  await cache.initialize()
  return {
    root,
    cache,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    },
  }
}

const sha = (content: string) => createHash("sha256").update(content).digest("hex")

describe("DirectoryScanner", () => {
  test.each([
    {
      name: "one oversized chunk among small ones",
      files: { "a.ts": "ok1\nTOOLONGCHUNK\nok2", "b.ts": "ok3\nok4" },
      bad: ["TOOLONGCHUNK"],
    },
    {
      name: "an oversized chunk in each file",
      files: { "a.ts": "ok1\nBADBADBAD1", "b.ts": "BADBADBAD2\nok2" },
      bad: ["BADBADBAD1", "BADBADBAD2"],
    },
  ])("never silently drops chunks when the provider rejects oversized input: $name", async ({ files, bad }) => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    try {
      for (const [name, content] of Object.entries(files)) await Bun.write(join(root, name), content)
      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const emb = new LimitEmb(8)
      const store = new RecordStore()
      const scan = new DirectoryScanner(emb, store, new SizedParser(), cache, ignore(), 10, 3)
      const errors: Error[] = []
      const indexed: number[] = []

      await scan.scanDirectory(
        root,
        (error) => errors.push(error),
        (count) => indexed.push(count),
      )

      const all = Object.values(files).flatMap((content) => content.split("\n"))
      const good = all.filter((chunk) => !bad.includes(chunk))
      expect(store.chunks.toSorted()).toEqual(good.toSorted())
      expect(errors).toHaveLength(bad.length)
      const badFiles = Object.entries(files)
        .filter(([, content]) => bad.some((chunk) => content.split("\n").includes(chunk)))
        .map(([name]) => join(root, name))
      for (const file of badFiles) {
        expect(errors.some((error) => error.message.includes(`Skipped ${file} lines`))).toBe(true)
      }
      expect(indexed.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(Object.keys(files).length)
      // A deterministic rejection is never retried verbatim: each distinct batch is sent at most once.
      const keys = emb.calls.map((call) => call.join("|"))
      expect(new Set(keys).size).toBe(keys.length)
    } finally {
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

  test("keeps capitalized source folders that match ignored dirs case-insensitively", async () => {
    // The anchored ignore globs (e.g. **/build/**) must match case-sensitively
    // like FileIgnore.match() does: on glob platforms with a nocase default
    // (macOS, Windows), they would prune valid sources such as src/Build/Main.ts.
    // Only the capitalized dirs exist, so this works on case-insensitive volumes
    // too and catches a regression on the platform where it actually occurs.
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    try {
      const kept = join(root, "src", "Build", "Main.ts")
      const keptTarget = join(root, "src", "Target", "Main.ts")
      const keptDesktop = join(root, "Desktop", "App.ts")
      const pruned = join(root, "build", "gen.ts")
      const prunedNested = join(root, "pkg", "build", "gen.ts")

      await mkdir(join(root, "src", "Build"), { recursive: true })
      await mkdir(join(root, "src", "Target"), { recursive: true })
      await mkdir(join(root, "Desktop"), { recursive: true })
      await mkdir(join(root, "build"), { recursive: true })
      await mkdir(join(root, "pkg", "build"), { recursive: true })
      await Bun.write(kept, "export const kept = 1\n")
      await Bun.write(keptTarget, "export const keptTarget = 1\n")
      await Bun.write(keptDesktop, "export const keptDesktop = 1\n")
      await Bun.write(pruned, "export const pruned = 1\n")
      await Bun.write(prunedNested, "export const prunedNested = 1\n")

      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()

      const scan = new DirectoryScanner(new Emb(), new Store(), new Parser(), cache, ignore(), 1, 1)
      const result = await scan.scanDirectory(root)

      expect(result.stats.processed).toBe(3)
      expect(cache.getHash(kept)).toBeDefined()
      expect(cache.getHash(keptTarget)).toBeDefined()
      expect(cache.getHash(keptDesktop)).toBeDefined()
      expect(cache.getHash(pruned)).toBeUndefined()
      expect(cache.getHash(prunedNested)).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
  test.each([{ threshold: 10 }, { threshold: 1 }])(
    "counts a file with a rejected chunk as indexed once when another chunk is written (threshold $threshold)",
    async ({ threshold }) => {
      const files = { "a.ts": "BADBADBAD1\nok1" }
      const { root, cache, cleanup } = await fixture(files)
      try {
        const store = new RecordStore()
        const scan = new DirectoryScanner(new LimitEmb(8), store, new SizedParser(), cache, ignore(), threshold, 3)
        const indexed: number[] = []

        await scan.scanDirectory(
          root,
          () => {},
          (count) => indexed.push(count),
        )

        expect(store.chunks).toEqual(["ok1"])
        expect(indexed.reduce((sum, count) => sum + count, 0)).toBe(1)
      } finally {
        await cleanup()
      }
    },
  )

  test("caches full files, marks partial files so the next scan reindexes them, and finds them when removed", async () => {
    const partial = "ok1\nBADBADBAD1"
    const full = "ok2\nok3"
    const { root, cache, cleanup } = await fixture({ "a.ts": partial, "b.ts": full })
    const a = join(root, "a.ts")
    const b = join(root, "b.ts")
    try {
      const store = new DeleteStore()
      const first = new DirectoryScanner(new LimitEmb(8), store, new SizedParser(), cache, ignore(), 10, 3)
      const errors: Error[] = []
      await first.scanDirectory(root, (error) => errors.push(error))

      expect(errors).toHaveLength(1)
      expect(cache.getHash(b)).toBe(sha(full))
      expect(cache.getHash(a)).toBeDefined()
      expect(cache.getHash(a)).not.toBe(sha(partial))

      // The provider now accepts everything: the partial file is changed (not new), so its old points go first.
      store.multi = []
      const second = new DirectoryScanner(new LimitEmb(100), store, new SizedParser(), cache, ignore(), 10, 3)
      await second.scanDirectory(root)

      expect(store.multi).toEqual([[a]])
      expect(cache.getHash(a)).toBe(sha(partial))

      // Marked again by a rejecting scan, then removed from disk: the deletion pass must find it.
      cache.updateHash(a, "partial:stale")
      await rm(a)
      await second.scanDirectory(root)

      expect(store.removed).toEqual([a])
      expect(cache.getHash(a)).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  test.each([
    { name: "one batch", chunks: 10, batches: 1 },
    { name: "several batches", chunks: 40, batches: 4 },
  ])("stops splitting when the provider rejects every request: $name", async ({ chunks, batches }) => {
    const content = Array.from({ length: chunks }, (_, index) => `chunk${index}`).join("\n")
    const { root, cache, cleanup } = await fixture({ "a.ts": content })
    try {
      const emb = new LimitEmb(0)
      const store = new RecordStore()
      const scan = new DirectoryScanner(emb, store, new SizedParser(), cache, ignore(), 10, 3)
      const errors: Error[] = []

      await scan.scanDirectory(root, (error) => errors.push(error))

      // One request per batch plus one shared probe, instead of 2N-1 per batch.
      expect(emb.calls.length).toBeLessThanOrEqual(batches + 1)
      if (batches === 1) expect(emb.calls.length).toBeLessThanOrEqual(3)
      expect(store.chunks).toEqual([])
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain("rejected every request")
      expect(errors[0]).not.toBeInstanceOf(RejectedChunkError)
      expect(cache.getHash(join(root, "a.ts"))).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  test("sends no probe or split request when cancelled while a batch is being rejected", async () => {
    const content = Array.from({ length: 10 }, (_, index) => `chunk${index}`).join("\n")
    const { root, cache, cleanup } = await fixture({ "a.ts": content })
    try {
      const store = new RecordStore()
      const calls: string[][] = []
      let scan: DirectoryScanner | undefined
      const emb: IEmbedder = {
        async createEmbeddings(texts) {
          calls.push(texts)
          scan?.cancel()
          throw Object.assign(new Error("input too large"), { status: 400 })
        },
        async validateConfiguration() {
          return { valid: true }
        },
        get embedderInfo() {
          return { name: "openai" as const }
        },
      }
      scan = new DirectoryScanner(emb, store, new SizedParser(), cache, ignore(), 10, 3)
      const errors: Error[] = []

      await scan.scanDirectory(root, (error) => errors.push(error))

      expect(calls).toHaveLength(1)
      expect(store.chunks).toEqual([])
      expect(errors).toEqual([])
    } finally {
      await cleanup()
    }
  })
})
