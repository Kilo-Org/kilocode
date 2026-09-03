import { describe, test, expect } from "bun:test"
import { mkdtemp, mkdir, rename, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { createHash } from "crypto"
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
import {
  FileWatcher,
  type FileWatchEvent,
  type FileWatchSubscribe,
} from "../../../../src/indexing/processors/file-watcher"
import { CodeParser } from "../../../../src/indexing/processors/parser"
import { loadIgnore, type IgnoreMatcher } from "../../../../src/indexing/shared/load-ignore"
import { WorktreeOverlay } from "../../../../src/indexing/worktree-overlay"

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
  public readonly points: PointStruct[] = []
  public readonly deletions: string[][] = []

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
  async deletePointsByMultipleFilePaths(files: string[]): Promise<void> {
    this.deletions.push(files)
  }
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

    await writeFile(file, baseline)
    overlay.block(file)
    await data.processBatch(new Map([[file, { path: file, type: "change" }]]))

    expect(overlay.shadows.has("file.ts")).toBe(false)
    expect(overlay.blocked.has("file.ts")).toBe(false)
    expect(cache.getHash(file)).toBe(baselineHash)
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
    if (first.status === "processed_for_batching" && first.newHash) cache.updateHash(custom, first.newHash)
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

describe("FileWatcher subscription", () => {
  // Injected fake backend so subscribe / event-mapping / degrade / teardown are
  // exercised without a real filesystem subscription.
  function createFakeBackend() {
    let onEvents: ((events: readonly FileWatchEvent[]) => void) | undefined
    let subscribed = 0
    let unsubscribed = 0
    let failNext = 0
    let lastIgnore: readonly string[] = []
    const subscribe: FileWatchSubscribe = async (_directory, cb, ignore) => {
      subscribed += 1
      lastIgnore = ignore
      if (failNext > 0) {
        failNext -= 1
        throw new Error("subscribe failed")
      }
      onEvents = cb
      return {
        unsubscribe: async () => {
          unsubscribed += 1
        },
      }
    }
    return {
      subscribe,
      emit: (events: FileWatchEvent[]) => onEvents?.(events),
      failOnce: () => {
        failNext = 1
      },
      get subscribed() {
        return subscribed
      },
      get unsubscribed() {
        return unsubscribed
      },
      get lastIgnore() {
        return lastIgnore
      },
    }
  }

  async function makeWatcher(subscribe: FileWatchSubscribe, ignoreInstance?: IgnoreMatcher, existingRoot?: string) {
    const root = existingRoot ?? (await mkdtemp(path.join(tmpdir(), "file-watcher-parcel-")))
    const cacheDir = path.join(root, ".cache")
    await mkdir(cacheDir, { recursive: true })
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const store = new RetryStore(0)
    const watcher = new FileWatcher(
      root,
      cache,
      createEmbedder(),
      store,
      ignoreInstance,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      subscribe,
    )
    const internals = watcher as unknown as {
      accumulatedEvents: Map<string, { path: string; type: "create" | "change" | "delete" }>
      triggerBatchProcessing(): Promise<void>
    }
    const drain = async () => {
      watcher.setCollecting(true)
      await internals.triggerBatchProcessing().finally(() => watcher.setCollecting(false))
    }
    return { root, watcher, cache, store, drain, accumulated: internals.accumulatedEvents }
  }

  test("initialize subscribes once and maps parcel events (update -> change)", async () => {
    const backend = createFakeBackend()
    const { root, watcher, accumulated } = await makeWatcher(backend.subscribe)
    await watcher.initialize()
    expect(backend.subscribed).toBe(1)

    const created = path.join(root, "created.ts")
    const changed = path.join(root, "changed.ts")
    const deleted = path.join(root, "deleted.ts")
    backend.emit([
      { path: created, type: "create" },
      { path: changed, type: "update" },
      { path: deleted, type: "delete" },
    ])

    expect(accumulated.get(created)?.type).toBe("create")
    expect(accumulated.get(changed)?.type).toBe("change")
    expect(accumulated.get(deleted)?.type).toBe("delete")
    await watcher.shutdown()
  })

  test("events for ignored or unsupported files are dropped", async () => {
    const backend = createFakeBackend()
    const { root, watcher, accumulated, drain, store } = await makeWatcher(backend.subscribe)
    await watcher.initialize()

    backend.emit([
      { path: path.join(root, "node_modules/dep/index.ts"), type: "create" }, // ignored directory
      { path: path.join(root, "image.png"), type: "create" }, // unsupported extension
    ])

    await drain()
    expect(accumulated.size).toBe(0)
    expect(store.points).toEqual([])
    expect(store.deletions).toEqual([])
    await watcher.shutdown()
  })

  test("clears old chunks when an atomic save is reported as create", async () => {
    const backend = createFakeBackend()
    const { root, watcher, cache, store, drain } = await makeWatcher(backend.subscribe)
    const file = path.join(root, "note.md")
    try {
      await watcher.initialize()
      await writeFile(file, "original content ".repeat(30))
      backend.emit([{ path: file, type: "create" }])
      await drain()
      const hash = cache.getHash(file)
      expect(hash).toBeDefined()
      expect(store.deletions).toEqual([])

      await writeFile(file + ".tmp", "replacement content ".repeat(30))
      await rename(file + ".tmp", file)
      backend.emit([{ path: file, type: "create" }])
      await drain()
      expect(store.deletions).toEqual([[file]])
      expect(cache.getHash(file)).not.toBe(hash)
    } finally {
      await watcher.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("expands directory moves and deletes without touching sibling paths", async () => {
    const backend = createFakeBackend()
    const { root, watcher, cache, store, drain } = await makeWatcher(backend.subscribe)
    const dir = path.join(root, "old")
    const next = path.join(root, "renamed.md")
    const file = path.join(dir, ".note.md")
    const moved = path.join(next, ".note.md")
    const sibling = path.join(root, "old-peer", "note.md")
    try {
      await mkdir(path.join(dir, "node_modules"), { recursive: true })
      await mkdir(path.dirname(sibling))
      await writeFile(file, "source content ".repeat(30))
      await writeFile(sibling, "sibling content ".repeat(30))
      await writeFile(path.join(dir, "image.png"), "unsupported")
      await writeFile(path.join(dir, "node_modules", "dep.md"), "ignored content ".repeat(30))
      await watcher.initialize()
      backend.emit([
        { path: dir, type: "create" },
        { path: sibling, type: "create" },
      ])
      await drain()
      expect(Object.keys(cache.getAllHashes()).sort()).toEqual([file, sibling].sort())

      await rename(dir, next)
      backend.emit([
        { path: dir, type: "delete" },
        { path: next, type: "create" },
      ])
      await drain()
      expect(Object.keys(cache.getAllHashes()).sort()).toEqual([moved, sibling].sort())
      expect(store.deletions).toEqual([[file]])

      await rm(next, { recursive: true })
      await mkdir(next)
      const replacement = path.join(next, "replacement.md")
      await writeFile(replacement, "replacement content ".repeat(30))
      backend.emit([
        { path: next, type: "delete" },
        { path: next, type: "create" },
      ])
      await drain()
      expect(Object.keys(cache.getAllHashes()).sort()).toEqual([replacement, sibling].sort())
      expect(store.deletions).toEqual([[file], [moved]])

      await rm(next, { recursive: true })
      backend.emit([{ path: next, type: "delete" }])
      await drain()
      expect(Object.keys(cache.getAllHashes())).toEqual([sibling])
      expect(store.deletions).toEqual([[file], [moved], [replacement]])
    } finally {
      await watcher.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("a failed subscribe degrades: initialize resolves without a subscription", async () => {
    const backend = createFakeBackend()
    backend.failOnce()
    const { watcher } = await makeWatcher(backend.subscribe)

    // Must not throw — the watcher is optional, so the full scan still runs.
    await watcher.initialize()
    expect(backend.subscribed).toBe(1)
    await watcher.shutdown()
    expect(backend.unsubscribed).toBe(0)
  })

  test("shutdown unsubscribes the watcher", async () => {
    const backend = createFakeBackend()
    const { watcher } = await makeWatcher(backend.subscribe)
    await watcher.initialize()
    await watcher.shutdown()
    expect(backend.unsubscribed).toBe(1)
  })

  test("forwards infra and gitignore-derived directory prunes to subscribe", async () => {
    const backend = createFakeBackend()
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-prune-"))
    try {
      await writeFile(path.join(root, ".gitignore"), ".venv/\n")
      await mkdir(path.join(root, "pkg"), { recursive: true })
      await writeFile(path.join(root, "pkg", ".gitignore"), "build/\n")
      const ignore = await loadIgnore(root)
      expect(ignore.watchIgnoreGlobs?.()).toEqual(expect.arrayContaining(["**/.venv", "pkg/**/build"]))

      const { watcher } = await makeWatcher(backend.subscribe, ignore, root)
      await watcher.initialize()
      // Both Kilo's infra dirs and the per-repo gitignore dirs reach the native watcher.
      expect(backend.lastIgnore).toEqual(expect.arrayContaining(["**/node_modules", "**/.venv", "pkg/**/build"]))
      await watcher.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("a re-include (!) drops the derived prune so the watcher can't hide an indexed file", async () => {
    const backend = createFakeBackend()
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-neg-"))
    try {
      await writeFile(path.join(root, ".gitignore"), ".venv/\n/pkg/data/\n!data/\n")
      const ignore = await loadIgnore(root)
      expect(ignore.ignores("pkg/data/file.ts")).toBe(false)
      expect(ignore.watchIgnoreGlobs?.()).toEqual([])

      const { watcher } = await makeWatcher(backend.subscribe, ignore, root)
      await watcher.initialize()
      expect(backend.lastIgnore).not.toContain("pkg/data")
      expect(backend.lastIgnore).toContain("**/node_modules")
      await watcher.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("skips derived prunes for ignore files inside glob-metachar directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-meta-"))
    try {
      // A .gitignore inside a metachar directory would emit a raw glob (e.g.
      // app/[slug]/**/generated) that prunes the wrong tree — and for a leading "!"
      // (e.g. a dir named "!scope") parcel reads it as a negation — so no prune glob
      // may be derived from it. A normal dir's prune still works.
      await mkdir(path.join(root, "app", "[slug]"), { recursive: true })
      await writeFile(path.join(root, "app", "[slug]", ".gitignore"), "generated\n")
      await mkdir(path.join(root, "!scope"), { recursive: true })
      await writeFile(path.join(root, "!scope", ".gitignore"), "cache\n")
      await writeFile(path.join(root, ".gitignore"), ".venv/\n")

      const globs = (await loadIgnore(root)).watchIgnoreGlobs?.() ?? []
      expect(globs).toContain("**/.venv")
      expect(globs.some((g) => g.includes("[slug]") || g.includes("generated"))).toBe(false)
      // No negation glob and nothing derived from the "!scope" tree.
      expect(globs.some((g) => g.startsWith("!") || g.includes("!scope") || g.includes("cache"))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("a subscription resolving after shutdown is torn down, not stored", async () => {
    let unsubscribed = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const subscribe: FileWatchSubscribe = async () => {
      await gate
      return {
        unsubscribe: async () => {
          unsubscribed += 1
        },
      }
    }
    const { watcher, accumulated } = await makeWatcher(subscribe)

    const init = watcher.initialize()
    await watcher.shutdown() // disposes while the subscribe is still pending
    release?.()
    await init

    // The late subscription is unsubscribed instead of stored on the disposed watcher.
    expect(unsubscribed).toBe(1)
    expect(accumulated.size).toBe(0)
  })

  test("a transient subscribe failure is retried on the next initialize", async () => {
    const backend = createFakeBackend()
    backend.failOnce()
    const { watcher } = await makeWatcher(backend.subscribe)

    await watcher.initialize() // fails -> degrades without a subscription
    expect(backend.subscribed).toBe(1)
    await watcher.initialize() // this.ready was reset, so the next run retries
    expect(backend.subscribed).toBe(2)

    await watcher.shutdown()
    expect(backend.unsubscribed).toBe(1)
  })
})
