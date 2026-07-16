/**
 * Integration tests for ValkeyVectorStore against a real Valkey server.
 *
 * These tests require a running Valkey server with the ValkeySearch module loaded.
 * They are skipped gracefully when no server is available.
 *
 * Environment variables:
 *   VALKEY_URL      - Valkey server URL (default: "redis://localhost:6379")
 *   VALKEY_PASSWORD - Optional password for authentication
 */
import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test"
import { GlideClient, GlideFt, RequestError } from "@valkey/valkey-glide"
import { ValkeyVectorStore } from "../../../../src/indexing/vector-store/valkey-vector-store"
import type { PointStruct } from "../../../../src/indexing/interfaces/vector-store"
import type { EmbeddingProfile } from "../../../../src/indexing/embedding-profile"
import { randomUUID } from "crypto"

const VALKEY_URL = process.env.VALKEY_URL ?? "redis://localhost:6379"
const VALKEY_PASSWORD = process.env.VALKEY_PASSWORD ?? undefined
const VECTOR_DIM = 4

// Unique workspace path per test run to avoid conflicts
const TEST_WORKSPACE = `/tmp/integration-test-${randomUUID()}`

const TEST_PROFILE: EmbeddingProfile = {
  provider: "openai",
  modelId: "text-embedding-3-small",
  dimension: VECTOR_DIM,
}

function makePoint(
  id: string,
  vector: number[],
  filePath: string,
  codeChunk: string,
  startLine: number,
  endLine: number,
): PointStruct {
  return {
    id,
    vector,
    payload: { filePath, codeChunk, startLine, endLine },
  }
}

/**
 * Creates a ValkeyVectorStore instance with a unique workspace path.
 */
function createStore(workspacePath?: string): ValkeyVectorStore {
  return new ValkeyVectorStore(workspacePath ?? TEST_WORKSPACE, VALKEY_URL, VECTOR_DIM, VALKEY_PASSWORD, TEST_PROFILE)
}

let serverAvailable = false
let flushClient: GlideClient | null = null

/**
 * Flushes the entire Valkey database to ensure a clean state.
 * Called before each test to prevent cross-test contamination.
 */
async function flushDatabase(): Promise<void> {
  if (!flushClient) return
  try {
    await flushClient.customCommand(["FLUSHDB"])
  } catch {
    // Ignore flush errors (e.g., if server is unavailable)
  }
}

beforeAll(async () => {
  try {
    const url = new URL(VALKEY_URL.startsWith("redis") ? VALKEY_URL : `redis://${VALKEY_URL}`)
    const client = await GlideClient.createClient({
      addresses: [{ host: url.hostname, port: url.port ? parseInt(url.port, 10) : 6379 }],
      credentials: VALKEY_PASSWORD ? { password: VALKEY_PASSWORD } : undefined,
      requestTimeout: 5000,
    })

    // Verify ValkeySearch module is loaded by trying FT.INFO on a non-existent index
    try {
      await GlideFt.info(client, "__valkey_integration_test_probe__")
    } catch (error) {
      // RequestError means the module is loaded but index doesn't exist — that's fine
      if (error instanceof RequestError) {
        serverAvailable = true
      }
      // Other errors mean the module isn't loaded
    }

    if (serverAvailable) {
      // Keep the client around for FLUSHDB between tests
      flushClient = client
      // Flush once at the start to ensure a clean slate
      await flushDatabase()
    } else {
      client.close()
    }
  } catch {
    // Server not reachable
    serverAvailable = false
  }
})

describe("ValkeyVectorStore Integration Tests", () => {
  let store: ValkeyVectorStore

  beforeAll(() => {
    if (!serverAvailable) {
      console.log("⚠️  Skipping integration tests: Valkey server not available at", VALKEY_URL)
    }
  })

  beforeEach(async () => {
    if (!serverAvailable) return
    // Flush the database before each test to ensure a clean state
    await flushDatabase()
  })

  afterEach(async () => {
    if (store) {
      try {
        await store.deleteCollection()
      } catch {
        // Ignore cleanup errors
      }
      await store.dispose()
    }
  })

  describe("Connection", () => {
    test("should connect successfully to Valkey server", async () => {
      if (!serverAvailable) return

      store = createStore()
      const created = await store.initialize()
      expect(created).toBe(true)

      const exists = await store.collectionExists()
      expect(exists).toBe(true)
    })

    test("should fail with auth error when wrong password is provided", async () => {
      if (!serverAvailable) return

      const badStore = new ValkeyVectorStore(
        `/tmp/bad-auth-${randomUUID()}`,
        VALKEY_URL,
        VECTOR_DIM,
        "definitely-wrong-password-12345",
        TEST_PROFILE,
      )

      try {
        await badStore.initialize()
        // If the server doesn't require auth, this might succeed — that's OK
        await badStore.deleteCollection()
        await badStore.dispose()
      } catch (error) {
        // Expected: auth failure or connection error
        expect(error).toBeDefined()
        await badStore.dispose()
      }
    })
  })

  describe("Full workflow: initialize → upsert → search → verify", () => {
    test("should upsert points and find them via search", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      // Upsert test points with known vectors
      const points: PointStruct[] = [
        makePoint("p1", [1, 0, 0, 0], "src/main.ts", "function main() {}", 1, 5),
        makePoint("p2", [0, 1, 0, 0], "src/utils.ts", "function helper() {}", 10, 15),
        makePoint("p3", [0.9, 0.1, 0, 0], "src/app.ts", "function app() {}", 20, 25),
      ]

      await store.upsertPoints(points)

      // Wait briefly for indexing to complete
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Search with a vector close to p1 and p3
      const results = await store.search([1, 0, 0, 0], undefined, 0.0, 10)

      expect(results.length).toBeGreaterThan(0)

      // The closest match to [1, 0, 0, 0] should be p1 (exact match, score ~1.0)
      const topResult = results[0]!
      expect(topResult.id).toBe("p1")
      expect(topResult.score).toBeGreaterThan(0.9)
      expect(topResult.payload?.filePath).toBe("src/main.ts")
      expect(topResult.payload?.codeChunk).toBe("function main() {}")
      expect(topResult.payload?.startLine).toBe(1)
      expect(topResult.payload?.endLine).toBe(5)

      // p3 should also be highly ranked (cosine similarity of [1,0,0,0] and [0.9,0.1,0,0] is high)
      const p3Result = results.find((r) => r.id === "p3")
      expect(p3Result).toBeDefined()
      expect(p3Result!.score).toBeGreaterThan(0.9)
    })

    test("should overwrite existing point on re-upsert", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      // Upsert initial point
      await store.upsertPoints([makePoint("p1", [1, 0, 0, 0], "src/old.ts", "old code", 1, 5)])

      await new Promise((resolve) => setTimeout(resolve, 300))

      // Overwrite with new data
      await store.upsertPoints([makePoint("p1", [0, 1, 0, 0], "src/new.ts", "new code", 10, 20)])

      await new Promise((resolve) => setTimeout(resolve, 300))

      // Search for the new vector
      const results = await store.search([0, 1, 0, 0], undefined, 0.0, 10)
      const p1 = results.find((r) => r.id === "p1")
      expect(p1).toBeDefined()
      expect(p1!.payload?.filePath).toBe("src/new.ts")
      expect(p1!.payload?.codeChunk).toBe("new code")
    })
  })

  describe("Directory prefix filtering", () => {
    test("should filter results by directory prefix", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const points: PointStruct[] = [
        makePoint("p1", [1, 0, 0, 0], "src/components/Button.ts", "button code", 1, 10),
        makePoint("p2", [0.95, 0.05, 0, 0], "src/utils/helpers.ts", "helper code", 1, 10),
        makePoint("p3", [0.9, 0.1, 0, 0], "lib/external.ts", "external code", 1, 10),
      ]

      await store.upsertPoints(points)
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Search with prefix "src" — should only return p1 and p2
      const srcResults = await store.search([1, 0, 0, 0], "src", 0.0, 10)
      const srcIds = srcResults.map((r) => r.id)
      expect(srcIds).toContain("p1")
      expect(srcIds).toContain("p2")
      expect(srcIds).not.toContain("p3")

      // Search with prefix "src/components" — should only return p1
      const compResults = await store.search([1, 0, 0, 0], "src/components", 0.0, 10)
      const compIds = compResults.map((r) => r.id)
      expect(compIds).toContain("p1")
      expect(compIds).not.toContain("p2")
      expect(compIds).not.toContain("p3")

      // Search with no prefix — should return all
      const allResults = await store.search([1, 0, 0, 0], "", 0.0, 10)
      expect(allResults.length).toBe(3)
    })

    test("should treat '.', './', and empty string as no filter", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const points: PointStruct[] = [
        makePoint("p1", [1, 0, 0, 0], "src/a.ts", "code a", 1, 5),
        makePoint("p2", [0, 1, 0, 0], "lib/b.ts", "code b", 1, 5),
      ]

      await store.upsertPoints(points)
      await new Promise((resolve) => setTimeout(resolve, 500))

      const dotResults = await store.search([1, 0, 0, 0], ".", 0.0, 10)
      const dotSlashResults = await store.search([1, 0, 0, 0], "./", 0.0, 10)
      const emptyResults = await store.search([1, 0, 0, 0], "", 0.0, 10)

      expect(dotResults.length).toBe(2)
      expect(dotSlashResults.length).toBe(2)
      expect(emptyResults.length).toBe(2)
    })
  })

  describe("GlideFt lifecycle: create → info → dropindex", () => {
    test("should create index, verify via info, and drop it", async () => {
      if (!serverAvailable) return

      store = createStore()

      // Initially collection should not exist
      const existsBefore = await store.collectionExists()
      expect(existsBefore).toBe(false)

      // Initialize creates the index
      const created = await store.initialize()
      expect(created).toBe(true)

      // Now it should exist
      const existsAfter = await store.collectionExists()
      expect(existsAfter).toBe(true)

      // Get index info
      const info = await store.getIndexInfo()
      expect(info).not.toBeNull()

      // Delete collection (drops index)
      await store.deleteCollection()

      // Should no longer exist
      const existsDeleted = await store.collectionExists()
      expect(existsDeleted).toBe(false)
    })

    test("should re-initialize after deletion", async () => {
      if (!serverAvailable) return

      store = createStore()

      await store.initialize()
      await store.deleteCollection()

      // Re-initialize should create a new index
      const created = await store.initialize()
      expect(created).toBe(true)
      expect(await store.collectionExists()).toBe(true)
    })
  })

  describe("Batch upsert performance", () => {
    test("should upsert 60 points in a single pipeline", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      // Generate 60 random points
      const points: PointStruct[] = []
      for (let i = 0; i < 60; i++) {
        const vector = Array.from({ length: VECTOR_DIM }, () => Math.random())
        // Normalize the vector for cosine similarity
        const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
        const normalized = vector.map((v) => v / magnitude)

        points.push(makePoint(`batch-${i}`, normalized, `src/file${i}.ts`, `code chunk ${i}`, i * 10, i * 10 + 9))
      }

      const startTime = Date.now()
      await store.upsertPoints(points)
      const elapsed = Date.now() - startTime

      // Wait for indexing
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Verify all 60 points are searchable
      // Search with a vector that should match at least some points
      const results = await store.search(points[0]!.vector, undefined, 0.0, 60)
      expect(results.length).toBe(60)

      // Verify the batch completed in reasonable time (< 10 seconds)
      expect(elapsed).toBeLessThan(10000)
    })
  })

  describe("Scan+delete: no orphaned keys after deleteCollection", () => {
    test("should leave no orphaned keys after deleteCollection", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      // Upsert some points
      const points: PointStruct[] = [
        makePoint("orphan-1", [1, 0, 0, 0], "src/a.ts", "code a", 1, 5),
        makePoint("orphan-2", [0, 1, 0, 0], "src/b.ts", "code b", 1, 5),
        makePoint("orphan-3", [0, 0, 1, 0], "src/c.ts", "code c", 1, 5),
      ]
      await store.upsertPoints(points)

      // Also mark indexing complete to create metadata key
      await store.markIndexingComplete()

      await new Promise((resolve) => setTimeout(resolve, 300))

      // Delete the collection
      await store.deleteCollection()

      // Verify no keys remain with the collection prefix
      const url = new URL(VALKEY_URL.startsWith("redis") ? VALKEY_URL : `redis://${VALKEY_URL}`)
      const verifyClient = await GlideClient.createClient({
        addresses: [{ host: url.hostname, port: url.port ? parseInt(url.port, 10) : 6379 }],
        credentials: VALKEY_PASSWORD ? { password: VALKEY_PASSWORD } : undefined,
        requestTimeout: 5000,
      })

      const collectionName = store.getCollectionName()
      const pattern = `${collectionName}:*`
      let cursor = "0"
      let orphanedKeys: string[] = []

      do {
        const [nextCursor, keys] = await verifyClient.scan(cursor, { match: pattern, count: 100 })
        cursor = nextCursor as string
        orphanedKeys = orphanedKeys.concat(keys as string[])
      } while (cursor !== "0")

      verifyClient.close()

      expect(orphanedKeys.length).toBe(0)
    })
  })

  describe("clearCollection preserves index structure", () => {
    test("should clear all points but keep the index", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      // Upsert points
      await store.upsertPoints([
        makePoint("clear-1", [1, 0, 0, 0], "src/a.ts", "code a", 1, 5),
        makePoint("clear-2", [0, 1, 0, 0], "src/b.ts", "code b", 1, 5),
      ])

      // Mark complete to create metadata
      await store.markIndexingComplete()
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Clear the collection
      await store.clearCollection()
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Index should still exist
      expect(await store.collectionExists()).toBe(true)

      // But search should return no results (points are gone)
      const results = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(results.length).toBe(0)

      // Can still upsert new points (index is functional)
      await store.upsertPoints([makePoint("clear-3", [0, 0, 1, 0], "src/c.ts", "code c", 1, 5)])
      await new Promise((resolve) => setTimeout(resolve, 300))

      const newResults = await store.search([0, 0, 1, 0], undefined, 0.0, 10)
      expect(newResults.length).toBeGreaterThan(0)
      expect(newResults[0]!.id).toBe("clear-3")
    })
  })

  describe("Metadata round-trip: markComplete → hasIndexedData → markIncomplete", () => {
    test("should track indexing state correctly", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      // Initially hasIndexedData should be false (no points, no metadata)
      expect(await store.hasIndexedData()).toBe(false)

      // Upsert a point
      await store.upsertPoints([makePoint("meta-1", [1, 0, 0, 0], "src/a.ts", "code", 1, 5)])
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Still false — metadata not set yet
      expect(await store.hasIndexedData()).toBe(false)

      // Mark indexing complete
      await store.markIndexingComplete()

      // Now should be true (has points + metadata + complete flag)
      expect(await store.hasIndexedData()).toBe(true)

      // Mark incomplete
      await store.markIndexingIncomplete()

      // Should be false again (complete flag is false)
      expect(await store.hasIndexedData()).toBe(false)

      // Mark complete again
      await store.markIndexingComplete()
      expect(await store.hasIndexedData()).toBe(true)
    })

    test("should return false for hasIndexedData when collection does not exist", async () => {
      if (!serverAvailable) return

      store = createStore(`/tmp/nonexistent-${randomUUID()}`)
      // Don't initialize — collection doesn't exist
      expect(await store.hasIndexedData()).toBe(false)
    })
  })

  describe("Point deletion by file path", () => {
    test("should delete points by file path", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const points: PointStruct[] = [
        makePoint("del-1", [1, 0, 0, 0], "src/target.ts", "target code", 1, 5),
        makePoint("del-2", [0.9, 0.1, 0, 0], "src/target.ts", "more target code", 6, 10),
        makePoint("del-3", [0, 1, 0, 0], "src/keep.ts", "keep code", 1, 5),
      ]

      await store.upsertPoints(points)
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Delete points for "src/target.ts"
      await store.deletePointsByFilePath("src/target.ts")
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Search should only find the kept point
      const results = await store.search([0, 1, 0, 0], undefined, 0.0, 10)
      const ids = results.map((r) => r.id)
      expect(ids).toContain("del-3")
      expect(ids).not.toContain("del-1")
      expect(ids).not.toContain("del-2")
    })

    test("should handle deletion of non-existent file path gracefully", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      // Should not throw
      await store.deletePointsByFilePath("nonexistent/file.ts")
      await store.deletePointsByMultipleFilePaths(["a.ts", "b.ts"])
    })
  })

  describe("hasIndexedData after clearCollection (gap #1)", () => {
    test("hasIndexedData remains true after clearCollection due to ValkeySearch num_docs behavior", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      await store.upsertPoints([
        makePoint("hid-1", [1, 0, 0, 0], "src/a.ts", "code a", 1, 5),
        makePoint("hid-2", [0, 1, 0, 0], "src/b.ts", "code b", 1, 5),
      ])
      await new Promise((resolve) => setTimeout(resolve, 300))
      await store.markIndexingComplete()
      expect(await store.hasIndexedData()).toBe(true)

      await store.clearCollection()
      await new Promise((resolve) => setTimeout(resolve, 500))

      // ValkeySearch's FT.INFO num_docs does NOT decrement when hash keys are
      // deleted via DEL (its technically a soft/lazy delete) — only on FT.DROPINDEX or index recreation.
      // The orchestrator works around this by calling markIndexingIncomplete().
      const hasData = await store.hasIndexedData()
      expect(hasData).toBe(true)

      // Search correctly returns nothing — the actual data is gone
      const results = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(results.length).toBe(0)

      await store.markIndexingIncomplete()
      expect(await store.hasIndexedData()).toBe(false)
    })

    test("search returns empty immediately after clearCollection regardless of num_docs", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      await store.upsertPoints([makePoint("hid-3", [1, 0, 0, 0], "src/a.ts", "code a", 1, 5)])
      await new Promise((resolve) => setTimeout(resolve, 300))
      await store.markIndexingComplete()

      await store.clearCollection()
      await new Promise((resolve) => setTimeout(resolve, 100))

      const results = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(results.length).toBe(0)
    })
  })

  describe("search on non-existent collection (gap #2)", () => {
    test("should return empty array when collection was never initialized", async () => {
      if (!serverAvailable) return

      store = createStore(`/tmp/never-initialized-${randomUUID()}`)

      const results = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(results).toEqual([])
    })
  })

  describe("deletePointsByFilePath on non-existent collection (gap #3)", () => {
    test("should not throw when collection was never initialized", async () => {
      if (!serverAvailable) return

      store = createStore(`/tmp/no-collection-del-${randomUUID()}`)

      await store.deletePointsByFilePath("src/anything.ts")
      await store.deletePointsByMultipleFilePaths(["a.ts", "b.ts", "c.ts"])
    })
  })

  describe("minScore filtering (gap #5)", () => {
    test("should exclude results below minScore threshold", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const points: PointStruct[] = [
        makePoint("exact", [1, 0, 0, 0], "src/exact.ts", "exact match", 1, 5),
        makePoint("close", [0.9, 0.1, 0, 0], "src/close.ts", "close match", 1, 5),
        makePoint("far", [0, 0, 0, 1], "src/far.ts", "far away", 1, 5),
      ]

      await store.upsertPoints(points)
      await new Promise((resolve) => setTimeout(resolve, 500))

      const results = await store.search([1, 0, 0, 0], undefined, 0.8, 10)

      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0.8)
      }

      const ids = results.map((r) => r.id)
      expect(ids).not.toContain("far")
      expect(ids).toContain("exact")
      expect(ids).toContain("close")
    })

    test("should return all results when minScore is 0", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const points: PointStruct[] = [
        makePoint("ms-1", [1, 0, 0, 0], "src/a.ts", "code", 1, 5),
        makePoint("ms-2", [0, 1, 0, 0], "src/b.ts", "code", 1, 5),
        makePoint("ms-3", [0, 0, 1, 0], "src/c.ts", "code", 1, 5),
      ]

      await store.upsertPoints(points)
      await new Promise((resolve) => setTimeout(resolve, 500))

      const results = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(results.length).toBe(3)
    })
  })

  describe("Deep path segments >5 levels (gap #6)", () => {
    test("should index and search files with paths deeper than 5 segments", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const deepPath = "a/b/c/d/e/f/g/h.ts"
      const shallowPath = "a/b/x.ts"

      await store.upsertPoints([
        makePoint("deep", [1, 0, 0, 0], deepPath, "deep code", 1, 5),
        makePoint("shallow", [0, 1, 0, 0], shallowPath, "shallow code", 1, 5),
      ])
      await new Promise((resolve) => setTimeout(resolve, 500))

      const results5 = await store.search([1, 0, 0, 0], "a/b/c/d/e", 0.0, 10)
      const ids5 = results5.map((r) => r.id)
      expect(ids5).toContain("deep")
      expect(ids5).not.toContain("shallow")

      const results2 = await store.search([1, 0, 0, 0], "a/b", 0.0, 10)
      const ids2 = results2.map((r) => r.id)
      expect(ids2).toContain("deep")
      expect(ids2).toContain("shallow")

      const allResults = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(allResults.map((r) => r.id)).toContain("deep")
    })

    test("should delete files with deep paths correctly", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const deepPath = "a/b/c/d/e/f/g/h.ts"
      await store.upsertPoints([makePoint("deep-del", [1, 0, 0, 0], deepPath, "deep code", 1, 5)])
      await new Promise((resolve) => setTimeout(resolve, 500))

      await store.deletePointsByFilePath(deepPath)
      await new Promise((resolve) => setTimeout(resolve, 300))

      const results = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(results.map((r) => r.id)).not.toContain("deep-del")
    })
  })

  describe("Special characters in file paths (gap #7)", () => {
    test("should handle file paths with dots correctly", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const dottedPath = "src/components/Button.test.spec.ts"
      await store.upsertPoints([makePoint("dotted", [1, 0, 0, 0], dottedPath, "test code", 1, 5)])
      await new Promise((resolve) => setTimeout(resolve, 500))

      const results = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(results.map((r) => r.id)).toContain("dotted")

      await store.deletePointsByFilePath(dottedPath)
      await new Promise((resolve) => setTimeout(resolve, 300))

      const afterDel = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(afterDel.map((r) => r.id)).not.toContain("dotted")
    })

    test("should handle file paths with hyphens and underscores", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const hyphenPath = "src/my-component/use_hook.ts"
      await store.upsertPoints([makePoint("hyphen", [1, 0, 0, 0], hyphenPath, "hook code", 1, 5)])
      await new Promise((resolve) => setTimeout(resolve, 500))

      const results = await store.search([1, 0, 0, 0], "src/my-component", 0.0, 10)
      expect(results.map((r) => r.id)).toContain("hyphen")

      await store.deletePointsByFilePath(hyphenPath)
      await new Promise((resolve) => setTimeout(resolve, 300))

      const afterDel = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(afterDel.map((r) => r.id)).not.toContain("hyphen")
    })

    test("should handle file paths with @ symbol", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const atPath = "@scope/package/src/index.ts"
      await store.upsertPoints([makePoint("at-sign", [1, 0, 0, 0], atPath, "scoped code", 1, 5)])
      await new Promise((resolve) => setTimeout(resolve, 500))

      const results = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(results.map((r) => r.id)).toContain("at-sign")
      expect(results.find((r) => r.id === "at-sign")!.payload?.filePath).toBe(atPath)

      await store.deletePointsByFilePath(atPath)
      await new Promise((resolve) => setTimeout(resolve, 300))

      const afterDel = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(afterDel.map((r) => r.id)).not.toContain("at-sign")
    })

    test("should handle file paths with parentheses and spaces", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const spacePath = "src/my file (copy).ts"
      await store.upsertPoints([makePoint("space-paren", [1, 0, 0, 0], spacePath, "copied code", 1, 5)])
      await new Promise((resolve) => setTimeout(resolve, 500))

      const results = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(results.map((r) => r.id)).toContain("space-paren")
      expect(results.find((r) => r.id === "space-paren")!.payload?.filePath).toBe(spacePath)

      await store.deletePointsByFilePath(spacePath)
      await new Promise((resolve) => setTimeout(resolve, 300))

      const afterDel = await store.search([1, 0, 0, 0], undefined, 0.0, 10)
      expect(afterDel.map((r) => r.id)).not.toContain("space-paren")
    })

    test("should handle batch deletion of paths with special characters", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      const paths = ["src/file-one.test.ts", "src/@utils/helper.ts", "lib/my_module/index.ts"]

      await store.upsertPoints([
        makePoint("sp-1", [1, 0, 0, 0], paths[0]!, "code 1", 1, 5),
        makePoint("sp-2", [0, 1, 0, 0], paths[1]!, "code 2", 1, 5),
        makePoint("sp-3", [0, 0, 1, 0], paths[2]!, "code 3", 1, 5),
        makePoint("sp-keep", [0, 0, 0, 1], "src/normal.ts", "keep this", 1, 5),
      ])
      await new Promise((resolve) => setTimeout(resolve, 500))

      await store.deletePointsByMultipleFilePaths(paths)
      await new Promise((resolve) => setTimeout(resolve, 300))

      const results = await store.search([0, 0, 0, 1], undefined, 0.0, 10)
      const ids = results.map((r) => r.id)
      expect(ids).toContain("sp-keep")
      expect(ids).not.toContain("sp-1")
      expect(ids).not.toContain("sp-2")
      expect(ids).not.toContain("sp-3")
    })
  })

  describe("Batch upsert at scale (gap #8)", () => {
    test("should upsert points in multiple sequential batches totaling >1000", async () => {
      if (!serverAvailable) return

      store = createStore()
      await store.initialize()

      // BATCH_CHUNK_SIZE=1000 boundary is verified in unit tests with mocks.
      // Here we verify 1200 points across 20 calls all get indexed against real Valkey.
      const PER_CALL = 60
      const CALLS = 20
      const TOTAL = PER_CALL * CALLS

      for (let batch = 0; batch < CALLS; batch++) {
        const points: PointStruct[] = Array.from({ length: PER_CALL }, (_, i) => {
          const idx = batch * PER_CALL + i
          const vector = Array.from({ length: VECTOR_DIM }, () => Math.random())
          const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
          const normalized = vector.map((v) => v / magnitude)
          return makePoint(`multi-batch-${idx}`, normalized, `src/file${idx % 50}.ts`, `c${idx}`, idx, idx + 5)
        })
        await store.upsertPoints(points)
      }

      await new Promise((resolve) => setTimeout(resolve, 3000))

      const info = await store.getIndexInfo()
      expect(info).not.toBeNull()
      const numDocs = typeof info!.num_docs === "string" ? parseInt(info!.num_docs, 10) : info!.num_docs
      expect(numDocs).toBe(TOTAL)

      const results = await store.search([1, 0, 0, 0], undefined, 0.0, 50)
      expect(results.length).toBeGreaterThan(0)
    }, 60000)
  })
})
