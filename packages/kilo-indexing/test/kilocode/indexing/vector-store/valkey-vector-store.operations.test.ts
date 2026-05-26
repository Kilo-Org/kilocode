import { describe, test, expect, beforeEach, mock } from "bun:test"

// Set up mocks BEFORE importing the module under test
const mockHset = mock()
const mockHgetall = mock()
const mockDel = mock()
const mockScan = mock()
const mockClose = mock()
const mockExec = mock()

const mockGlideClientInstance = {
  hset: mockHset,
  hgetall: mockHgetall,
  del: mockDel,
  scan: mockScan,
  close: mockClose,
  exec: mockExec,
}

const mockCreateClient = mock(() => Promise.resolve(mockGlideClientInstance))

const mockGlideFtInfo = mock()
const mockGlideFtSearch = mock()
const mockGlideFtCreate = mock()
const mockGlideFtDropindex = mock()

// Track Batch instances for verification
const mockBatchHset = mock()
let batchInstances: any[] = []

class MockBatch {
  nonAtomic: boolean
  constructor(nonAtomic: boolean) {
    this.nonAtomic = nonAtomic
    batchInstances.push(this)
  }
  hset = mockBatchHset
}

mock.module("@valkey/valkey-glide", () => ({
  GlideClient: {
    createClient: mockCreateClient,
  },
  GlideFt: {
    info: mockGlideFtInfo,
    search: mockGlideFtSearch,
    create: mockGlideFtCreate,
    dropindex: mockGlideFtDropindex,
  },
  Batch: MockBatch,
  ClosingError: class ClosingError extends Error {},
  RequestError: class RequestError extends Error {},
  SortOrder: { ASC: "ASC", DESC: "DESC" },
}))

// Now import the module under test
import { ValkeyVectorStore } from "../../../../src/indexing/vector-store/valkey-vector-store"
import type { PointStruct } from "../../../../src/indexing/interfaces/vector-store"

describe("ValkeyVectorStore Operations", () => {
  let store: ValkeyVectorStore
  const workspacePath = "/test/workspace"
  const vectorSize = 128

  beforeEach(() => {
    // Reset all mocks
    mockHset.mockReset()
    mockHgetall.mockReset()
    mockDel.mockReset()
    mockScan.mockReset()
    mockClose.mockReset()
    mockExec.mockReset()
    mockCreateClient.mockReset()
    mockGlideFtInfo.mockReset()
    mockGlideFtSearch.mockReset()
    mockGlideFtCreate.mockReset()
    mockGlideFtDropindex.mockReset()
    mockBatchHset.mockReset()
    batchInstances = []

    mockCreateClient.mockResolvedValue(mockGlideClientInstance)

    store = new ValkeyVectorStore(workspacePath, "redis://localhost:6379", vectorSize)
  })

  // Helper to connect the store (sets up the internal client)
  async function connectStore() {
    // Trigger ensureConnected by calling initialize.
    // Mock getIndexInfo to return null (index doesn't exist) so it just creates without dropping.
    const { RequestError } = await import("@valkey/valkey-glide")
    // First call: getIndexInfo() → GlideFt.info throws RequestError (index not found)
    mockGlideFtInfo.mockRejectedValueOnce(new RequestError("Unknown index"))
    // Second call: createIndex() → collectionExists() → GlideFt.info throws RequestError
    mockGlideFtInfo.mockRejectedValueOnce(new RequestError("Unknown index"))
    // Then GlideFt.create succeeds
    mockGlideFtCreate.mockResolvedValueOnce("OK")
    await store.initialize()
    // Reset mocks after initialization
    mockGlideFtInfo.mockReset()
    mockGlideFtSearch.mockReset()
    mockGlideFtCreate.mockReset()
    mockExec.mockReset()
    mockBatchHset.mockReset()
    batchInstances = []
  }

  function makePoint(id: string, filePath: string, vector?: number[]): PointStruct {
    return {
      id,
      vector: vector ?? Array(vectorSize).fill(0.5),
      payload: {
        filePath,
        codeChunk: `// code in ${filePath}`,
        startLine: 1,
        endLine: 10,
      },
    }
  }

  describe("upsertPoints()", () => {
    test("should store points with correct hash fields, vector encoding, and path segments", async () => {
      await connectStore()
      mockExec.mockResolvedValueOnce([1])

      const point = makePoint("point-1", "src/utils/helper.ts")

      await store.upsertPoints([point])

      // Verify batch was created as non-atomic
      expect(batchInstances.length).toBe(1)
      expect(batchInstances[0].nonAtomic).toBe(false)

      // Verify hset was called on the batch with correct key and fields
      expect(mockBatchHset).toHaveBeenCalledTimes(1)
      const [key, fields] = mockBatchHset.mock.calls[0]

      const collectionName = store.getCollectionName()
      expect(key).toBe(`${collectionName}:point-1`)

      // Verify payload fields
      expect(fields.filePath).toBe("src/utils/helper.ts")
      expect(fields.codeChunk).toBe("// code in src/utils/helper.ts")
      expect(fields.startLine).toBe("1")
      expect(fields.endLine).toBe("10")
      expect(fields.type).toBe("point")

      // Verify path segments
      expect(fields.seg0).toBe("src")
      expect(fields.seg1).toBe("utils")
      expect(fields.seg2).toBe("helper.ts")

      // Verify vector is a Buffer (FLOAT32 encoding)
      expect(fields.vector).toBeInstanceOf(Buffer)
      expect(fields.vector.length).toBe(vectorSize * 4) // 4 bytes per float32

      // Verify exec was called with the batch
      expect(mockExec).toHaveBeenCalledTimes(1)
      expect(mockExec).toHaveBeenCalledWith(batchInstances[0], true)
    })

    test("should handle multiple points in a single batch", async () => {
      await connectStore()
      mockExec.mockResolvedValueOnce([1, 1])

      const points = [makePoint("p1", "src/a.ts"), makePoint("p2", "lib/b.ts")]

      await store.upsertPoints(points)

      expect(batchInstances.length).toBe(1)
      expect(mockBatchHset).toHaveBeenCalledTimes(2)

      const collectionName = store.getCollectionName()
      expect(mockBatchHset.mock.calls[0][0]).toBe(`${collectionName}:p1`)
      expect(mockBatchHset.mock.calls[1][0]).toBe(`${collectionName}:p2`)
    })

    test("should return without performing any operations when given an empty array", async () => {
      await connectStore()

      await store.upsertPoints([])

      // No batch should be created, no exec called
      expect(batchInstances.length).toBe(0)
      expect(mockExec).not.toHaveBeenCalled()
    })

    test("should encode vector as FLOAT32 little-endian buffer", async () => {
      await connectStore()
      mockExec.mockResolvedValueOnce([1])

      const vector = [1.0, 2.5, -3.0, 0.0]
      const point: PointStruct = {
        id: "vec-test",
        vector,
        payload: { filePath: "test.ts", codeChunk: "code", startLine: 1, endLine: 5 },
      }

      // Create store with matching dimension
      const smallStore = new ValkeyVectorStore(workspacePath, "redis://localhost:6379", 4)
      // Initialize to connect
      const { RequestError } = await import("@valkey/valkey-glide")
      mockGlideFtInfo.mockRejectedValueOnce(new RequestError("Unknown index"))
      mockGlideFtInfo.mockRejectedValueOnce(new RequestError("Unknown index"))
      mockGlideFtCreate.mockResolvedValueOnce("OK")
      await smallStore.initialize()
      mockExec.mockReset()
      mockBatchHset.mockReset()
      batchInstances = []
      mockExec.mockResolvedValueOnce([1])

      await smallStore.upsertPoints([point])

      const [, fields] = mockBatchHset.mock.calls[0]
      const buf = fields.vector as Buffer

      // Verify FLOAT32 encoding
      expect(buf.readFloatLE(0)).toBeCloseTo(1.0)
      expect(buf.readFloatLE(4)).toBeCloseTo(2.5)
      expect(buf.readFloatLE(8)).toBeCloseTo(-3.0)
      expect(buf.readFloatLE(12)).toBeCloseTo(0.0)
    })

    test("should cap path segments at 5 levels", async () => {
      await connectStore()
      mockExec.mockResolvedValueOnce([1])

      const point = makePoint("deep-path", "a/b/c/d/e/f/g/h.ts")

      await store.upsertPoints([point])

      const [, fields] = mockBatchHset.mock.calls[0]
      expect(fields.seg0).toBe("a")
      expect(fields.seg1).toBe("b")
      expect(fields.seg2).toBe("c")
      expect(fields.seg3).toBe("d")
      expect(fields.seg4).toBe("e")
      // seg5+ should not exist
      expect(fields.seg5).toBeUndefined()
      expect(fields.seg6).toBeUndefined()
    })
  })

  describe("search()", () => {
    test("should search with default minScore and maxResults", async () => {
      await connectStore()

      // Mock GlideFt.info to indicate collection exists
      mockGlideFtInfo.mockResolvedValueOnce({ num_docs: 5, fields: [] })

      // Mock search results
      const collectionName = store.getCollectionName()
      mockGlideFtSearch.mockResolvedValueOnce([
        1, // count
        [
          {
            key: `${collectionName}:point-1`,
            value: [
              { key: "filePath", value: "src/main.ts" },
              { key: "codeChunk", value: "function main() {}" },
              { key: "startLine", value: "1" },
              { key: "endLine", value: "5" },
              { key: "score", value: "0.2" }, // distance 0.2 → similarity 0.8
            ],
          },
        ],
      ])

      const queryVector = Array(vectorSize).fill(0.1)
      const results = await store.search(queryVector)

      // Verify GlideFt.search was called
      expect(mockGlideFtSearch).toHaveBeenCalledTimes(1)
      const [, indexName, query] = mockGlideFtSearch.mock.calls[0]
      expect(indexName).toBe(collectionName)
      // Default maxResults is 50
      expect(query).toContain("[KNN 50 @vector $BLOB AS score]")
      // Default filter includes @type:{point}
      expect(query).toContain("@type:{point}")

      // Verify results
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe("point-1")
      expect(results[0].score).toBeCloseTo(0.8) // 1 - 0.2
      expect(results[0].payload?.filePath).toBe("src/main.ts")
      expect(results[0].payload?.codeChunk).toBe("function main() {}")
      expect(results[0].payload?.startLine).toBe(1)
      expect(results[0].payload?.endLine).toBe(5)
    })

    test("should apply directory prefix filter", async () => {
      await connectStore()

      mockGlideFtInfo.mockResolvedValueOnce({ num_docs: 5, fields: [] })
      const collectionName = store.getCollectionName()
      mockGlideFtSearch.mockResolvedValueOnce([
        1,
        [
          {
            key: `${collectionName}:point-2`,
            value: [
              { key: "filePath", value: "src/utils/helper.ts" },
              { key: "codeChunk", value: "export function help() {}" },
              { key: "startLine", value: "10" },
              { key: "endLine", value: "20" },
              { key: "score", value: "0.1" },
            ],
          },
        ],
      ])

      const queryVector = Array(vectorSize).fill(0.1)
      const results = await store.search(queryVector, "src/utils")

      const [, , query] = mockGlideFtSearch.mock.calls[0]
      // Should include segment filters
      expect(query).toContain("@seg0:{src}")
      expect(query).toContain("@seg1:{utils}")
      expect(query).toContain("@type:{point}")

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe("point-2")
      expect(results[0].score).toBeCloseTo(0.9) // 1 - 0.1
    })

    test("should not apply directory filter for '.' prefix", async () => {
      await connectStore()

      mockGlideFtInfo.mockResolvedValueOnce({ num_docs: 5, fields: [] })
      mockGlideFtSearch.mockResolvedValueOnce([0, []])

      const queryVector = Array(vectorSize).fill(0.1)
      await store.search(queryVector, ".")

      const [, , query] = mockGlideFtSearch.mock.calls[0]
      expect(query).toBe("(@type:{point})=>[KNN 50 @vector $BLOB AS score]")
    })

    test("should not apply directory filter for './' prefix", async () => {
      await connectStore()

      mockGlideFtInfo.mockResolvedValueOnce({ num_docs: 5, fields: [] })
      mockGlideFtSearch.mockResolvedValueOnce([0, []])

      const queryVector = Array(vectorSize).fill(0.1)
      await store.search(queryVector, "./")

      const [, , query] = mockGlideFtSearch.mock.calls[0]
      expect(query).toBe("(@type:{point})=>[KNN 50 @vector $BLOB AS score]")
    })

    test("should not apply directory filter for empty string prefix", async () => {
      await connectStore()

      mockGlideFtInfo.mockResolvedValueOnce({ num_docs: 5, fields: [] })
      mockGlideFtSearch.mockResolvedValueOnce([0, []])

      const queryVector = Array(vectorSize).fill(0.1)
      await store.search(queryVector, "")

      const [, , query] = mockGlideFtSearch.mock.calls[0]
      expect(query).toBe("(@type:{point})=>[KNN 50 @vector $BLOB AS score]")
    })

    test("should return empty array when collection doesn't exist", async () => {
      await connectStore()

      // Mock GlideFt.info to throw RequestError (collection doesn't exist)
      const { RequestError } = await import("@valkey/valkey-glide")
      mockGlideFtInfo.mockRejectedValueOnce(new RequestError("Index not found"))

      const queryVector = Array(vectorSize).fill(0.1)
      const results = await store.search(queryVector)

      expect(results).toEqual([])
      expect(mockGlideFtSearch).not.toHaveBeenCalled()
    })

    test("should throw on vector dimension mismatch", async () => {
      await connectStore()

      // Query vector with wrong dimension (64 instead of 128)
      const wrongDimensionVector = Array(64).fill(0.1)

      await expect(store.search(wrongDimensionVector)).rejects.toThrow(/Vector dimension mismatch/)
    })

    test("should filter results below minScore threshold", async () => {
      await connectStore()

      mockGlideFtInfo.mockResolvedValueOnce({ num_docs: 5, fields: [] })
      const collectionName = store.getCollectionName()
      mockGlideFtSearch.mockResolvedValueOnce([
        3,
        [
          {
            key: `${collectionName}:high`,
            value: [
              { key: "filePath", value: "a.ts" },
              { key: "codeChunk", value: "high" },
              { key: "startLine", value: "1" },
              { key: "endLine", value: "2" },
              { key: "score", value: "0.1" }, // similarity 0.9
            ],
          },
          {
            key: `${collectionName}:medium`,
            value: [
              { key: "filePath", value: "b.ts" },
              { key: "codeChunk", value: "medium" },
              { key: "startLine", value: "1" },
              { key: "endLine", value: "2" },
              { key: "score", value: "0.5" }, // similarity 0.5
            ],
          },
          {
            key: `${collectionName}:low`,
            value: [
              { key: "filePath", value: "c.ts" },
              { key: "codeChunk", value: "low" },
              { key: "startLine", value: "1" },
              { key: "endLine", value: "2" },
              { key: "score", value: "0.9" }, // similarity 0.1
            ],
          },
        ],
      ])

      const queryVector = Array(vectorSize).fill(0.1)
      // Use minScore of 0.6 — should only return the high-score result
      const results = await store.search(queryVector, undefined, 0.6)

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe("high")
      expect(results[0].score).toBeCloseTo(0.9)
    })

    test("should respect custom maxResults parameter", async () => {
      await connectStore()

      mockGlideFtInfo.mockResolvedValueOnce({ num_docs: 5, fields: [] })
      mockGlideFtSearch.mockResolvedValueOnce([0, []])

      const queryVector = Array(vectorSize).fill(0.1)
      await store.search(queryVector, undefined, undefined, 10)

      const [, , query] = mockGlideFtSearch.mock.calls[0]
      expect(query).toContain("[KNN 10 @vector $BLOB AS score]")
    })
  })

  describe("deletePointsByFilePath()", () => {
    test("should find and delete matching keys", async () => {
      await connectStore()

      const collectionName = store.getCollectionName()

      // Mock collectionExists check
      mockGlideFtInfo.mockResolvedValueOnce({ num_docs: 5, fields: [] })

      // Mock GlideFt.search to return matching documents
      mockGlideFtSearch.mockResolvedValueOnce([
        2,
        [{ key: `${collectionName}:chunk-1` }, { key: `${collectionName}:chunk-2` }],
      ])

      mockDel.mockResolvedValueOnce(2)

      await store.deletePointsByFilePath("src/main.ts")

      // Verify search was called with filePath TAG filter
      expect(mockGlideFtSearch).toHaveBeenCalledTimes(1)
      const [, indexName, query] = mockGlideFtSearch.mock.calls[0]
      expect(indexName).toBe(collectionName)
      expect(query).toContain("@filePath:{src/main\\.ts}")

      // Verify del was called with the found keys
      expect(mockDel).toHaveBeenCalledTimes(1)
      expect(mockDel).toHaveBeenCalledWith([`${collectionName}:chunk-1`, `${collectionName}:chunk-2`])
    })

    test("should not call del when no matching keys found", async () => {
      await connectStore()

      // Mock collectionExists
      mockGlideFtInfo.mockResolvedValueOnce({ num_docs: 5, fields: [] })

      // Mock search returns no results
      mockGlideFtSearch.mockResolvedValueOnce([0, []])

      await store.deletePointsByFilePath("nonexistent.ts")

      expect(mockDel).not.toHaveBeenCalled()
    })
  })

  describe("deletePointsByMultipleFilePaths()", () => {
    test("should return without performing any operations when given an empty array", async () => {
      await connectStore()

      await store.deletePointsByMultipleFilePaths([])

      // Should not check collection existence or search
      expect(mockGlideFtInfo).not.toHaveBeenCalled()
      expect(mockGlideFtSearch).not.toHaveBeenCalled()
      expect(mockDel).not.toHaveBeenCalled()
    })

    test("should return silently when collection doesn't exist", async () => {
      await connectStore()

      // Mock collectionExists to return false (RequestError)
      const { RequestError } = await import("@valkey/valkey-glide")
      mockGlideFtInfo.mockRejectedValueOnce(new RequestError("Index not found"))

      await store.deletePointsByMultipleFilePaths(["src/a.ts", "src/b.ts"])

      // Should not attempt search or delete
      expect(mockGlideFtSearch).not.toHaveBeenCalled()
      expect(mockDel).not.toHaveBeenCalled()
    })

    test("should delete points for multiple file paths", async () => {
      await connectStore()

      const collectionName = store.getCollectionName()

      // Mock collectionExists
      mockGlideFtInfo.mockResolvedValueOnce({ num_docs: 10, fields: [] })

      // Mock search for first file path
      mockGlideFtSearch.mockResolvedValueOnce([1, [{ key: `${collectionName}:chunk-a1` }]])
      // Mock search for second file path
      mockGlideFtSearch.mockResolvedValueOnce([
        2,
        [{ key: `${collectionName}:chunk-b1` }, { key: `${collectionName}:chunk-b2` }],
      ])

      mockDel.mockResolvedValueOnce(3)

      await store.deletePointsByMultipleFilePaths(["src/a.ts", "src/b.ts"])

      // Verify search was called for each file path
      expect(mockGlideFtSearch).toHaveBeenCalledTimes(2)

      // Verify all found keys were deleted in one call
      expect(mockDel).toHaveBeenCalledTimes(1)
      expect(mockDel).toHaveBeenCalledWith([
        `${collectionName}:chunk-a1`,
        `${collectionName}:chunk-b1`,
        `${collectionName}:chunk-b2`,
      ])
    })
  })
})
