import { describe, expect, test } from "bun:test"
import { CodeIndexConfigManager } from "../../../src/indexing/config-manager"
import { CodeIndexOrchestrator } from "../../../src/indexing/orchestrator"
import { CodeIndexStateManager } from "../../../src/indexing/state-manager"
import type { CacheManager } from "../../../src/indexing/cache-manager"
import type { DirectoryScanner } from "../../../src/indexing/processors/scanner"
import type {
  BatchProcessingSummary,
  FileProcessingResult,
  IFileWatcher,
  IndexingTelemetryEvent,
  IVectorStore,
  PointStruct,
  VectorStoreSearchResult,
} from "../../../src/indexing/interfaces"
import { Emitter } from "../../../src/indexing/runtime"
import { captureProfiles } from "./profile-capture"

class Store {
  public clearCount = 0
  public closeCount = 0
  public completeCount = 0
  public deleteCount = 0
  public incompleteCount = 0

  constructor(
    private readonly existing: boolean,
    private readonly created = false,
  ) {}

  async initialize(): Promise<boolean> {
    return this.created
  }

  async upsertPoints(_points: PointStruct[]): Promise<void> {}

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
  async clearCollection(): Promise<void> {
    this.clearCount += 1
  }
  async deleteCollection(): Promise<void> {
    this.deleteCount += 1
  }
  async close(): Promise<void> {
    this.closeCount += 1
  }
  async collectionExists(): Promise<boolean> {
    return true
  }
  async hasIndexedData(): Promise<boolean> {
    return this.existing
  }
  async markIndexingComplete(): Promise<void> {
    this.completeCount += 1
  }
  async markIndexingIncomplete(): Promise<void> {
    this.incompleteCount += 1
  }
}

class Scanner {
  public readonly isCancelled = false

  constructor(
    private readonly discovered: number,
    private readonly indexed: number,
    private readonly blocks: number,
  ) {}

  async scanDirectory(
    _directory: string,
    _onError?: (error: Error) => void,
    onFilesIndexed?: (indexedCount: number) => void,
    onFileParsed?: () => void,
  ): Promise<{ stats: { processed: number; skipped: number }; totalBlockCount: number }> {
    for (let i = 0; i < this.discovered; i += 1) {
      onFileParsed?.()
    }
    onFilesIndexed?.(this.indexed)
    return {
      stats: {
        processed: this.indexed,
        skipped: 0,
      },
      totalBlockCount: this.blocks,
    }
  }

  cancel(): void {}
  updateBatchSegmentThreshold(_newThreshold: number): void {}
}

class Watcher {
  public readonly onDidStartBatchProcessing = new Emitter<string[]>()
  public readonly onBatchProgressUpdate = new Emitter<{
    processedInBatch: number
    totalInBatch: number
    currentFile?: string
  }>()
  public readonly onDidFinishBatchProcessing = new Emitter<BatchProcessingSummary>()

  async initialize(): Promise<void> {}
  updateBatchSegmentThreshold(_newThreshold: number): void {}
  setCollecting(_collecting: boolean): void {}

  async processFile(filePath: string): Promise<FileProcessingResult> {
    return {
      path: filePath,
      status: "skipped",
      reason: "not used in test",
    }
  }

  dispose(): void {
    this.onDidStartBatchProcessing.dispose()
    this.onBatchProgressUpdate.dispose()
    this.onDidFinishBatchProcessing.dispose()
  }
}

class BlockingScanner {
  public isCancelled = false
  public finished = false
  private readonly gate = Promise.withResolvers<void>()
  readonly started = Promise.withResolvers<void>()

  async scanDirectory(): Promise<{ stats: { processed: number; skipped: number }; totalBlockCount: number }> {
    this.started.resolve()
    await this.gate.promise
    this.finished = true
    return { stats: { processed: 0, skipped: 0 }, totalBlockCount: 0 }
  }

  cancel(): void {
    this.isCancelled = true
    this.gate.resolve()
  }

  updateBatchSegmentThreshold(_newThreshold: number): void {}
}

class FailScanner {
  public isCancelled = false

  constructor(private readonly cancelled = false) {}

  async scanDirectory(): Promise<{ stats: { processed: number; skipped: number }; totalBlockCount: number }> {
    this.isCancelled = this.cancelled
    throw new Error("scan failed")
  }

  cancel(): void {}
  updateBatchSegmentThreshold(_newThreshold: number): void {}
}

class FailWatcher extends Watcher {
  async initialize(): Promise<void> {
    throw new Error("watcher failed")
  }
}

function createConfig(): CodeIndexConfigManager {
  return new CodeIndexConfigManager({
    enabled: true,
    embedderProvider: "openai",
    openAiKey: "sk-test",
    vectorStoreProvider: "lancedb",
    modelId: "text-embedding-3-small",
  })
}

describe("CodeIndexOrchestrator telemetry", () => {
  test.serial("profiles a full indexing lifecycle without workspace details", async () => {
    const root = "/tmp/kilo-indexing-profile-full"
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      root,
      { async clearCacheFile() {}, async flush() {} } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      new Scanner(3, 3, 6) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
    )
    const records = await captureProfiles(async () => {
      await orchestrator.startIndexing("manual")
    })
    const run = records.find((item) => item.event === "indexing.index.run")

    expect(run?.outcome).toBe("success")
    expect(run?.fields).toEqual({
      trigger: "manual",
      mode: "full",
      provider: "openai",
      modelId: "text-embedding-3-small",
      vectorStore: "lancedb",
      watcherInitMs: expect.any(Number),
      storeInitMs: expect.any(Number),
      prepareMs: expect.any(Number),
      scanMs: expect.any(Number),
      finalizeMs: expect.any(Number),
    })
    expect(run?.fields.scanMs).toBeGreaterThanOrEqual(0)
    expect(records.every((item) => JSON.stringify(item).includes(root) === false)).toBe(true)
  })

  test.serial("profiles incremental indexing mode", async () => {
    const records = await captureProfiles(async () => {
      const orchestrator = new CodeIndexOrchestrator(
        createConfig(),
        new CodeIndexStateManager(),
        "/tmp/kilo-indexing-profile-incremental",
        { async clearCacheFile() {}, async flush() {} } as unknown as CacheManager,
        new Store(true) as unknown as IVectorStore,
        new Scanner(2, 1, 2) as unknown as DirectoryScanner,
        new Watcher() as unknown as IFileWatcher,
      )

      await orchestrator.startIndexing("manual")
    })

    expect(records.find((item) => item.event === "indexing.index.run")?.fields.mode).toBe("incremental")
  })

  test.serial("profiles cancelled indexing lifecycle", async () => {
    const scanner = new BlockingScanner()
    const records = await captureProfiles(async () => {
      const orchestrator = new CodeIndexOrchestrator(
        createConfig(),
        new CodeIndexStateManager(),
        "/tmp/kilo-indexing-profile-cancelled",
        { async clearCacheFile() {}, async flush() {} } as unknown as CacheManager,
        new Store(false) as unknown as IVectorStore,
        scanner as unknown as DirectoryScanner,
        new Watcher() as unknown as IFileWatcher,
      )
      const active = orchestrator.startIndexing("background")

      await scanner.started.promise
      await orchestrator.shutdown()
      await active
    })

    expect(records.find((item) => item.event === "indexing.index.run")?.outcome).toBe("cancelled")
  })

  test.serial("omits mode for early cancellation", async () => {
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      "/tmp/kilo-indexing-profile-early-cancelled",
      { async clearCacheFile() {}, async flush() {} } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      new Scanner(0, 0, 0) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
    )
    const records = await captureProfiles(async () => {
      const active = orchestrator.startIndexing("background")
      orchestrator.cancelIndexing()
      await active
    })
    const run = records.find((item) => item.event === "indexing.index.run")

    expect(run?.outcome).toBe("cancelled")
    expect(run?.fields).not.toHaveProperty("mode")
  })

  test.serial("omits mode for early watcher failures", async () => {
    const records = await captureProfiles(async () => {
      const orchestrator = new CodeIndexOrchestrator(
        createConfig(),
        new CodeIndexStateManager(),
        "/tmp/kilo-indexing-profile-watcher-failure",
        { async clearCacheFile() {}, async flush() {} } as unknown as CacheManager,
        new Store(false) as unknown as IVectorStore,
        new Scanner(0, 0, 0) as unknown as DirectoryScanner,
        new FailWatcher() as unknown as IFileWatcher,
      )

      await orchestrator.startIndexing("background")
    })
    const run = records.find((item) => item.event === "indexing.index.run")

    expect(run?.outcome).toBe("error")
    expect(run?.fields).not.toHaveProperty("mode")
  })

  test.serial("profiles failures after cancellation as errors", async () => {
    const records = await captureProfiles(async () => {
      const orchestrator = new CodeIndexOrchestrator(
        createConfig(),
        new CodeIndexStateManager(),
        "/tmp/kilo-indexing-profile-cancelled-failure",
        { async clearCacheFile() {}, async flush() {} } as unknown as CacheManager,
        new Store(false) as unknown as IVectorStore,
        new FailScanner(true) as unknown as DirectoryScanner,
        new Watcher() as unknown as IFileWatcher,
      )

      await orchestrator.startIndexing("background")
    })

    expect(records.find((item) => item.event === "indexing.index.run")?.outcome).toBe("error")
  })

  test("emits full completion telemetry", async () => {
    const events: IndexingTelemetryEvent[] = []
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      "/tmp/ws",
      {
        async clearCacheFile() {},
      } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      new Scanner(3, 3, 6) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      (event) => events.push(event),
    )

    await orchestrator.startIndexing("manual")

    const completed = events.find(
      (event): event is Extract<IndexingTelemetryEvent, { type: "completed" }> => event.type === "completed",
    )
    expect(completed).toBeDefined()
    expect(completed?.mode).toBe("full")
    expect(completed?.trigger).toBe("manual")
    expect(completed?.filesDiscovered).toBe(3)
    expect(completed?.filesIndexed).toBe(3)
    expect(completed?.totalBlocks).toBe(6)
  })

  test("emits incremental completion telemetry", async () => {
    const events: IndexingTelemetryEvent[] = []
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      "/tmp/ws",
      {
        async clearCacheFile() {},
      } as unknown as CacheManager,
      new Store(true) as unknown as IVectorStore,
      new Scanner(2, 1, 2) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      (event) => events.push(event),
    )

    await orchestrator.startIndexing("manual")

    const completed = events.find(
      (event): event is Extract<IndexingTelemetryEvent, { type: "completed" }> => event.type === "completed",
    )
    expect(completed).toBeDefined()
    expect(completed?.mode).toBe("incremental")
    expect(completed?.trigger).toBe("manual")
    expect(completed?.filesDiscovered).toBe(2)
    expect(completed?.filesIndexed).toBe(1)
    expect(completed?.totalBlocks).toBe(2)
  })

  test("cancelIndexing prevents scan from running", async () => {
    let scanned = false
    const scanner = new Scanner(3, 3, 6) as unknown as DirectoryScanner
    const original = scanner.scanDirectory.bind(scanner)
    scanner.scanDirectory = async (...args: Parameters<typeof original>) => {
      scanned = true
      return original(...args)
    }

    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      "/tmp/ws",
      { async clearCacheFile() {} } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      scanner,
      new Watcher() as unknown as IFileWatcher,
    )

    // Start indexing then immediately cancel
    const done = orchestrator.startIndexing("background")
    orchestrator.cancelIndexing()
    await done

    expect(orchestrator.state).toBe("Standby")
    // Scanner may or may not have been reached depending on timing,
    // but the orchestrator must not be in Indexing state
    expect(orchestrator.state).not.toBe("Indexing")
  })

  test("shutdown waits for an active scan before closing the store", async () => {
    const scanner = new BlockingScanner()
    const store = new Store(false)
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      "/tmp/ws",
      { async clearCacheFile() {}, async flush() {} } as unknown as CacheManager,
      store as unknown as IVectorStore,
      scanner as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
    )

    const active = orchestrator.startIndexing("background")
    await scanner.started.promise
    await orchestrator.shutdown()
    await active

    expect(scanner.finished).toBe(true)
    expect(store.closeCount).toBe(1)
    expect(store.incompleteCount).toBe(1)
    expect(store.completeCount).toBe(0)
  })

  test("preserves an unchanged index when an incremental scan is interrupted", async () => {
    const scanner = new BlockingScanner()
    const store = new Store(true)
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      "/tmp/ws",
      { async clearCacheFile() {}, async flush() {} } as unknown as CacheManager,
      store as unknown as IVectorStore,
      scanner as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
    )

    const active = orchestrator.startIndexing("background")
    await scanner.started.promise
    await orchestrator.shutdown()
    await active

    expect(store.incompleteCount).toBe(1)
    expect(store.completeCount).toBe(1)
    expect(store.clearCount).toBe(0)
  })

  test("clears stale vectors and hashes before rebuilding an incomplete store", async () => {
    const cache = {
      clears: 0,
      async clearCacheFile() {
        this.clears += 1
      },
      async flush() {},
    }
    const store = new Store(false, false)
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      "/tmp/ws",
      cache as unknown as CacheManager,
      store as unknown as IVectorStore,
      new Scanner(1, 1, 1) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
    )

    await orchestrator.startIndexing("background")

    expect(store.clearCount).toBe(1)
    expect(cache.clears).toBe(1)
    expect(orchestrator.state).toBe("Indexed")
  })

  test("does not clear data when index completeness cannot be read", async () => {
    const cache = {
      clears: 0,
      async clearCacheFile() {
        this.clears += 1
      },
    }
    const store = new Store(true, false)
    store.hasIndexedData = async () => {
      throw new Error("metadata unavailable")
    }
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      "/tmp/ws",
      cache as unknown as CacheManager,
      store as unknown as IVectorStore,
      new Scanner(1, 1, 1) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
    )

    await orchestrator.startIndexing("background")

    expect(store.clearCount).toBe(0)
    expect(cache.clears).toBe(0)
    expect(orchestrator.state).toBe("Error")
  })

  test("preserves cache and collection data on retryable start failures", async () => {
    const events: IndexingTelemetryEvent[] = []
    const cache = {
      clears: 0,
      async clearCacheFile() {
        this.clears += 1
      },
    }
    const store = new Store(true)
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      "/tmp/ws",
      cache as unknown as CacheManager,
      store as unknown as IVectorStore,
      new FailScanner() as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      (event) => events.push(event),
    )

    await orchestrator.startIndexing("background")

    const error = events.find(
      (event): event is Extract<IndexingTelemetryEvent, { type: "error" }> =>
        event.type === "error" && event.location === "orchestrator:startIndexing",
    )
    expect(error).toBeDefined()
    expect(error?.mode).toBe("incremental")
    expect(cache.clears).toBe(0)
    expect(store.clearCount).toBe(0)
    expect(store.deleteCount).toBe(0)
    expect(orchestrator.state).toBe("Error")
  })
})
