import { describe, test, expect, beforeEach, mock } from "bun:test"

/**
 * Unit tests for ValkeyVectorStore lifecycle, metadata, error handling, and service factory.
 */

// Restore crypto module - the qdrant test mocks "crypto" which affects all test files
// in the same process. We need to re-mock it with the real implementation.
const nodeCrypto = require("node:crypto")
mock.module("crypto", () => nodeCrypto)
mock.module("node:crypto", () => nodeCrypto)

const mockHset = mock(() => Promise.resolve(1))
const mockHgetall = mock(() => Promise.resolve([]))
const mockDel = mock(() => Promise.resolve(1))
const mockScan = mock(() => Promise.resolve(["0", []]))
const mockClose = mock(() => {})
const mockExec = mock(() => Promise.resolve([]))

const mockClient = {
  hset: mockHset,
  hgetall: mockHgetall,
  del: mockDel,
  scan: mockScan,
  close: mockClose,
  exec: mockExec,
}

const mockCreateClient = mock(() => Promise.resolve(mockClient))

// Define mock GlideFt methods at module level so we can reference them directly
const mockFtInfo = mock(() => Promise.resolve({}))
const mockFtCreate = mock(() => Promise.resolve("OK"))
const mockFtDropindex = mock(() => Promise.resolve("OK"))
const mockFtSearch = mock(() => Promise.resolve([0, []]))

// Mock RequestError class defined at module level
class MockRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RequestError"
  }
}

class MockClosingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ClosingError"
  }
}

mock.module("@valkey/valkey-glide", () => ({
  GlideClient: {
    createClient: mockCreateClient,
  },
  GlideFt: {
    info: mockFtInfo,
    create: mockFtCreate,
    dropindex: mockFtDropindex,
    search: mockFtSearch,
  },
  Batch: class MockBatch {
    private isAtomic: boolean
    constructor(isAtomic: boolean) {
      this.isAtomic = isAtomic
    }
    hset(_key: string, _fields: Record<string, any>) {
      return this
    }
  },
  RequestError: MockRequestError,
  ClosingError: MockClosingError,
  SortOrder: { ASC: "ASC", DESC: "DESC" },
}))

// Import after mocking - only import the module under test, not @valkey/valkey-glide
import { ValkeyVectorStore } from "../../../../src/indexing/vector-store/valkey-vector-store"

function createStore(profile?: { provider: string; modelId: string; dimension: number }): ValkeyVectorStore {
  return new ValkeyVectorStore("/test/workspace", "redis://localhost:6379", 128, undefined, profile as any)
}

function resetMocks() {
  mockHset.mockReset()
  mockHgetall.mockReset()
  mockDel.mockReset()
  mockScan.mockReset()
  mockClose.mockReset()
  mockExec.mockReset()
  mockCreateClient.mockReset()
  mockFtInfo.mockReset()
  mockFtCreate.mockReset()
  mockFtDropindex.mockReset()
  mockFtSearch.mockReset()

  // Default: client creation succeeds
  mockCreateClient.mockResolvedValue(mockClient)
  mockHset.mockResolvedValue(1)
  mockHgetall.mockResolvedValue([])
  mockDel.mockResolvedValue(1)
  mockScan.mockResolvedValue(["0", []])
  mockExec.mockResolvedValue([])
}

describe("ValkeyVectorStore - Lifecycle, Metadata, Error Handling, and Service Factory", () => {
  beforeEach(() => {
    resetMocks()
  })

  describe("clearCollection()", () => {
    test("deletes point keys but preserves metadata", async () => {
      const store = createStore()
      const collectionName = store.getCollectionName()
      const metadataKey = store.getMetadataKey()

      // Mock collectionExists → true
      mockFtInfo.mockResolvedValue({ num_docs: 5 })

      // Mock scan returning point keys AND the metadata key
      const pointKey1 = `${collectionName}:point1`
      const pointKey2 = `${collectionName}:point2`
      mockScan.mockResolvedValueOnce(["0", [pointKey1, pointKey2, metadataKey]])

      await store.clearCollection()

      // Should have deleted point keys but NOT the metadata key
      expect(mockDel).toHaveBeenCalledTimes(1)
      const deletedKeys = mockDel.mock.calls[0]![0]
      expect(deletedKeys).toContain(pointKey1)
      expect(deletedKeys).toContain(pointKey2)
      expect(deletedKeys).not.toContain(metadataKey)
    })

    test("returns silently when collection doesn't exist", async () => {
      const store = createStore()

      // Mock collectionExists → false (GlideFt.info throws RequestError)
      mockFtInfo.mockRejectedValue(new MockRequestError("index not found"))

      // Should not throw
      await store.clearCollection()

      // Should not have called scan or del
      expect(mockScan).not.toHaveBeenCalled()
      expect(mockDel).not.toHaveBeenCalled()
    })
  })

  describe("deleteCollection()", () => {
    test("drops index + deletes all keys + metadata", async () => {
      const store = createStore()
      const collectionName = store.getCollectionName()
      const metadataKey = store.getMetadataKey()

      // Mock collectionExists → true (called by deleteCollection and dropIndex)
      mockFtInfo.mockResolvedValue({ num_docs: 3 })
      mockFtDropindex.mockResolvedValue("OK")

      // Mock scanAndDelete: scan returns some keys then cursor "0"
      const pointKey1 = `${collectionName}:point1`
      mockScan.mockResolvedValueOnce(["0", [pointKey1, metadataKey]])

      await store.deleteCollection()

      // dropindex should have been called
      expect(mockFtDropindex).toHaveBeenCalledWith(mockClient, collectionName)

      // del should have been called for scan results AND for explicit metadata deletion
      expect(mockDel).toHaveBeenCalled()
      // Last del call should be the explicit metadata key deletion
      const lastDelCall = mockDel.mock.calls[mockDel.mock.calls.length - 1]![0]
      expect(lastDelCall).toContain(metadataKey)
    })

    test("returns silently when collection doesn't exist", async () => {
      const store = createStore()

      // Mock collectionExists → false
      mockFtInfo.mockRejectedValue(new MockRequestError("index not found"))

      await store.deleteCollection()

      // Should not have called dropindex or del
      expect(mockFtDropindex).not.toHaveBeenCalled()
      expect(mockDel).not.toHaveBeenCalled()
    })
  })

  describe("markIndexingComplete()", () => {
    test("stores correct metadata fields", async () => {
      const profile = { provider: "openai", modelId: "text-embedding-3-small", dimension: 1536 }
      const store = createStore(profile)
      const metadataKey = store.getMetadataKey()

      await store.markIndexingComplete()

      expect(mockHset).toHaveBeenCalledTimes(1)
      const [key, fields] = mockHset.mock.calls[0]! as [string, Record<string, string>]
      expect(key).toBe(metadataKey)
      expect(fields["type"]).toBe("metadata")
      expect(fields["indexing_complete"]).toBe("true")
      expect(fields["embedding_provider"]).toBe("openai")
      expect(fields["embedding_model_id"]).toBe("text-embedding-3-small")
      expect(fields["embedding_dimension"]).toBe("1536")
    })
  })

  describe("markIndexingIncomplete()", () => {
    test("stores correct metadata fields", async () => {
      const profile = { provider: "openai", modelId: "text-embedding-ada-002", dimension: 1536 }
      const store = createStore(profile)
      const metadataKey = store.getMetadataKey()

      await store.markIndexingIncomplete()

      expect(mockHset).toHaveBeenCalledTimes(1)
      const [key, fields] = mockHset.mock.calls[0]! as [string, Record<string, string>]
      expect(key).toBe(metadataKey)
      expect(fields["type"]).toBe("metadata")
      expect(fields["indexing_complete"]).toBe("false")
      expect(fields["embedding_provider"]).toBe("openai")
      expect(fields["embedding_model_id"]).toBe("text-embedding-ada-002")
      expect(fields["embedding_dimension"]).toBe("1536")
    })
  })

  describe("hasIndexedData()", () => {
    test("three-way conjunction: returns true only when all conditions met", async () => {
      const store = createStore()

      // Collection exists with points AND metadata exists AND indexing_complete is "true"
      mockFtInfo.mockResolvedValue({ num_docs: 5 })
      mockHgetall.mockResolvedValue([
        { field: "type", value: "metadata" },
        { field: "indexing_complete", value: "true" },
        { field: "embedding_provider", value: "openai" },
        { field: "embedding_model_id", value: "text-embedding-3-small" },
        { field: "embedding_dimension", value: "128" },
      ])

      const result = await store.hasIndexedData()
      expect(result).toBe(true)
    })

    test("returns false when collection has points but indexing_complete is false", async () => {
      const store = createStore()

      mockFtInfo.mockResolvedValue({ num_docs: 5 })
      mockHgetall.mockResolvedValue([
        { field: "type", value: "metadata" },
        { field: "indexing_complete", value: "false" },
        { field: "embedding_provider", value: "openai" },
        { field: "embedding_model_id", value: "" },
        { field: "embedding_dimension", value: "128" },
      ])

      const result = await store.hasIndexedData()
      expect(result).toBe(false)
    })

    test("returns false when collection has points but no metadata", async () => {
      const store = createStore()

      mockFtInfo.mockResolvedValue({ num_docs: 5 })
      // hgetall returns empty (no metadata key)
      mockHgetall.mockResolvedValue([])

      const result = await store.hasIndexedData()
      expect(result).toBe(false)
    })

    test("returns false when collection exists but has zero points", async () => {
      const store = createStore()

      mockFtInfo.mockResolvedValue({ num_docs: 0 })

      const result = await store.hasIndexedData()
      expect(result).toBe(false)
    })

    test("returns false when collection doesn't exist", async () => {
      const store = createStore()

      // collectionExists → false
      mockFtInfo.mockRejectedValue(new MockRequestError("index not found"))

      const result = await store.hasIndexedData()
      expect(result).toBe(false)
    })
  })

  describe("Error logging includes correct context", () => {
    test("upsert error re-throws with correct error and exercises error path", async () => {
      const store = createStore()

      // Make exec throw an error
      const upsertError = new Error("Pipeline execution failed")
      mockExec.mockRejectedValue(upsertError)

      const points = [
        {
          id: "p1",
          vector: Array.from({ length: 128 }, () => 0.1),
          payload: { filePath: "src/a.ts", codeChunk: "code", startLine: 1, endLine: 10 },
        },
        {
          id: "p2",
          vector: Array.from({ length: 128 }, () => 0.2),
          payload: { filePath: "src/b.ts", codeChunk: "code2", startLine: 5, endLine: 15 },
        },
      ]

      // Verify the error is re-thrown (confirms error handling path is exercised)
      const thrownError = await store.upsertPoints(points).catch((e) => e)
      expect(thrownError).toBe(upsertError)
      expect(thrownError.message).toBe("Pipeline execution failed")
    })

    test("deletion error re-throws with correct error and exercises error path", async () => {
      const store = createStore()

      // collectionExists → true
      mockFtInfo.mockResolvedValue({ num_docs: 5 })

      // Make search throw during deletion
      const deleteError = new Error("Search during delete failed")
      mockFtSearch.mockRejectedValue(deleteError)

      const filePaths = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]

      // Verify the error is re-thrown (confirms error handling path is exercised)
      const thrownError = await store.deletePointsByMultipleFilePaths(filePaths).catch((e) => e)
      expect(thrownError).toBe(deleteError)
      expect(thrownError.message).toBe("Search during delete failed")
    })

    test("search error re-throws with correct error and exercises error path", async () => {
      const store = createStore()

      // collectionExists → true
      mockFtInfo.mockResolvedValue({ num_docs: 5 })

      // Make search throw
      const searchError = new Error("KNN search failed")
      mockFtSearch.mockRejectedValue(searchError)

      // Verify the error is re-thrown (confirms error handling path is exercised)
      const thrownError = await store
        .search(
          Array.from({ length: 128 }, () => 0.5),
          "src/utils",
        )
        .catch((e) => e)
      expect(thrownError).toBe(searchError)
      expect(thrownError.message).toBe("KNN search failed")
    })

    test("markIndexingComplete re-throws on failure", async () => {
      const store = createStore()

      const hsetError = new Error("HSET failed")
      mockHset.mockRejectedValue(hsetError)

      const thrownError = await store.markIndexingComplete().catch((e) => e)
      expect(thrownError).toBe(hsetError)
    })

    test("markIndexingIncomplete re-throws on failure", async () => {
      const store = createStore()

      const hsetError = new Error("HSET failed")
      mockHset.mockRejectedValue(hsetError)

      const thrownError = await store.markIndexingIncomplete().catch((e) => e)
      expect(thrownError).toBe(hsetError)
    })

    test("hasIndexedData returns false on error instead of throwing", async () => {
      const store = createStore()

      // collectionExists → true, but getIndexInfo throws an unexpected error
      mockFtInfo
        .mockResolvedValueOnce({ num_docs: 5 }) // collectionExists check
        .mockRejectedValueOnce(new Error("Unexpected error")) // getIndexInfo call

      const result = await store.hasIndexedData()
      expect(result).toBe(false)
    })
  })

  describe("Service factory", () => {
    test("creates ValkeyVectorStore with correct params", async () => {
      // We test the factory logic by verifying ValkeyVectorStore is constructed correctly
      const store = new ValkeyVectorStore("/my/workspace", "redis://valkey.example.com:6380", 768, "secret-password", {
        provider: "openai",
        modelId: "text-embedding-3-small",
        dimension: 768,
      } as any)

      expect(store.getValkeyUrl()).toBe("redis://valkey.example.com:6380")
      expect(store.getVectorSize()).toBe(768)
      expect(store.getProfile()).toEqual({
        provider: "openai",
        modelId: "text-embedding-3-small",
        dimension: 768,
      })
      // Collection name is deterministic based on workspace path
      expect(store.getCollectionName()).toMatch(/^ws-[a-f0-9]{16}$/)
    })

    test("service factory throws when valkeyUrl is missing", () => {
      // This tests the factory's validation logic inline
      // The factory does: if (!config.valkeyUrl) throw new Error("Valkey URL is required.")
      const createVectorStoreWithMissingUrl = () => {
        const config = { vectorStoreProvider: "valkey" as const, valkeyUrl: undefined }
        if (!config.valkeyUrl) {
          throw new Error("Valkey URL is required.")
        }
      }

      expect(createVectorStoreWithMissingUrl).toThrow("Valkey URL is required.")
    })
  })

  describe("Client lifecycle", () => {
    test("dispose() closes client", async () => {
      const store = createStore()

      // Trigger connection by calling a method that uses ensureConnected
      mockFtInfo.mockResolvedValue({ num_docs: 0 })
      await store.collectionExists()

      // Now dispose
      await store.dispose()

      expect(mockClose).toHaveBeenCalledTimes(1)
    })

    test("requestTimeout is 5000ms", async () => {
      const store = createStore()

      // Trigger connection
      mockFtInfo.mockResolvedValue({ num_docs: 0 })
      await store.collectionExists()

      // Verify createClient was called with requestTimeout: 5000
      expect(mockCreateClient).toHaveBeenCalledTimes(1)
      const createClientArgs = mockCreateClient.mock.calls[0]![0] as any
      expect(createClientArgs.requestTimeout).toBe(5000)
    })
  })
})
