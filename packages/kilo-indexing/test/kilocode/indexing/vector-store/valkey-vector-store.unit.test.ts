import { describe, test, expect, beforeEach, mock } from "bun:test"
import { createHash } from "crypto"

// Mock GlideClient and GlideFt before importing the module under test

const mockHset = mock(() => Promise.resolve(null))
const mockHgetall = mock(() => Promise.resolve([]))
const mockDel = mock(() => Promise.resolve(0))
const mockScan = mock(() => Promise.resolve(["0", []]))
const mockClose = mock(() => {})
const mockExec = mock(() => Promise.resolve([]))

const mockClientInstance = {
  hset: mockHset,
  hgetall: mockHgetall,
  del: mockDel,
  scan: mockScan,
  close: mockClose,
  exec: mockExec,
}

const mockCreateClient = mock(() => Promise.resolve(mockClientInstance))

// Mock GlideFt static methods
const mockFtInfo = mock(() => Promise.resolve({}))
const mockFtCreate = mock(() => Promise.resolve("OK"))
const mockFtDropindex = mock(() => Promise.resolve("OK"))
const mockFtSearch = mock(() => Promise.resolve([0, []]))

// Create a mock RequestError class
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

// Mock Batch class
const mockBatchHset = mock(() => {})
class MockBatch {
  constructor(_nonAtomic: boolean) {}
  hset = mockBatchHset
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
  RequestError: MockRequestError,
  ClosingError: MockClosingError,
  Batch: MockBatch,
  SortOrder: { ASC: "ASC", DESC: "DESC" },
}))

// Now import the module under test
import { ValkeyVectorStore } from "../../../../src/indexing/vector-store/valkey-vector-store"

const TEST_WORKSPACE = "/test/workspace"
const TEST_URL = "redis://localhost:6379"
const TEST_VECTOR_SIZE = 1536
const TEST_PASSWORD = "test-password"

const TEST_PROFILE = {
  provider: "openai" as const,
  modelId: "text-embedding-3-small",
  dimension: 1536,
}

// Compute expected collection name
const expectedHash = createHash("sha256").update(TEST_WORKSPACE).digest("hex")
const expectedCollectionName = `ws-${expectedHash.substring(0, 16)}`
const expectedMetadataKey = `${expectedCollectionName}:__metadata__`

function createStore(profile?: typeof TEST_PROFILE): ValkeyVectorStore {
  return new ValkeyVectorStore(TEST_WORKSPACE, TEST_URL, TEST_VECTOR_SIZE, TEST_PASSWORD, profile)
}

function resetAllMocks() {
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
  mockBatchHset.mockReset()

  // Restore default implementations
  mockCreateClient.mockImplementation(() => Promise.resolve(mockClientInstance))
  mockHset.mockImplementation(() => Promise.resolve(null))
  mockHgetall.mockImplementation(() => Promise.resolve([]))
  mockDel.mockImplementation(() => Promise.resolve(0))
  mockScan.mockImplementation(() => Promise.resolve(["0", []]))
  mockExec.mockImplementation(() => Promise.resolve([]))
  mockFtCreate.mockImplementation(() => Promise.resolve("OK"))
  mockFtDropindex.mockImplementation(() => Promise.resolve("OK"))
}

describe("ValkeyVectorStore Unit Tests", () => {
  beforeEach(() => {
    resetAllMocks()
  })

  describe("Constructor", () => {
    test("generates correct collection name from workspace path", () => {
      const store = createStore()
      expect(store.getCollectionName()).toBe(expectedCollectionName)
    })

    test("generates correct metadata key", () => {
      const store = createStore()
      expect(store.getMetadataKey()).toBe(expectedMetadataKey)
    })

    test("stores vector size", () => {
      const store = createStore()
      expect(store.getVectorSize()).toBe(TEST_VECTOR_SIZE)
    })

    test("stores provided EmbeddingProfile", () => {
      const store = createStore(TEST_PROFILE)
      const profile = store.getProfile()
      expect(profile.provider).toBe("openai")
      expect(profile.modelId).toBe("text-embedding-3-small")
      expect(profile.dimension).toBe(1536)
    })

    test("uses default EmbeddingProfile when none provided", () => {
      const store = new ValkeyVectorStore(TEST_WORKSPACE, TEST_URL, 768)
      const profile = store.getProfile()
      expect(profile.provider).toBe("openai")
      expect(profile.modelId).toBe("")
      expect(profile.dimension).toBe(768)
    })

    test("normalizes URL without scheme by prepending redis://", () => {
      const store = new ValkeyVectorStore(TEST_WORKSPACE, "localhost:6379", TEST_VECTOR_SIZE)
      expect(store.getValkeyUrl()).toBe("redis://localhost:6379")
    })

    test("preserves existing redis:// scheme", () => {
      const store = new ValkeyVectorStore(TEST_WORKSPACE, "redis://myhost:6380", TEST_VECTOR_SIZE)
      expect(store.getValkeyUrl()).toBe("redis://myhost:6380")
    })

    test("preserves existing rediss:// scheme", () => {
      const store = new ValkeyVectorStore(TEST_WORKSPACE, "rediss://secure-host:6380", TEST_VECTOR_SIZE)
      expect(store.getValkeyUrl()).toBe("rediss://secure-host:6380")
    })
  })

  describe("initialize()", () => {
    test("creates index and returns true when index does not exist", async () => {
      const store = createStore(TEST_PROFILE)

      // GlideFt.info throws RequestError → index doesn't exist
      mockFtInfo.mockImplementation(() => {
        throw new MockRequestError("Unknown index name")
      })

      const result = await store.initialize()

      expect(result).toBe(true)
      expect(mockFtCreate).toHaveBeenCalledTimes(1)
    })

    test("returns false when index exists with matching dimension and zero docs", async () => {
      const store = createStore(TEST_PROFILE)

      // GlideFt.info returns index info with matching dimension and 0 docs
      mockFtInfo.mockImplementation(() =>
        Promise.resolve({
          fields: [
            {
              type: "VECTOR",
              vector_params: { dimension: TEST_VECTOR_SIZE },
            },
          ],
          num_docs: 0,
        }),
      )

      const result = await store.initialize()

      expect(result).toBe(false)
      expect(mockFtCreate).not.toHaveBeenCalled()
      expect(mockFtDropindex).not.toHaveBeenCalled()
    })

    test("returns false when index exists with matching dimension, has docs, and stored profile matches", async () => {
      const store = createStore(TEST_PROFILE)

      // GlideFt.info returns index with matching dimension and docs
      mockFtInfo.mockImplementation(() =>
        Promise.resolve({
          fields: [
            {
              type: "VECTOR",
              vector_params: { dimension: TEST_VECTOR_SIZE },
            },
          ],
          num_docs: 5,
        }),
      )

      // Metadata returns matching profile
      mockHgetall.mockImplementation(() =>
        Promise.resolve([
          { field: "type", value: "metadata" },
          { field: "indexing_complete", value: "true" },
          { field: "embedding_provider", value: "openai" },
          { field: "embedding_model_id", value: "text-embedding-3-small" },
          { field: "embedding_dimension", value: "1536" },
        ]),
      )

      const result = await store.initialize()

      expect(result).toBe(false)
      expect(mockFtCreate).not.toHaveBeenCalled()
      expect(mockFtDropindex).not.toHaveBeenCalled()
    })

    test("drops and recreates index when stored profile has no metadata (legacy collection)", async () => {
      const store = createStore(TEST_PROFILE)

      // First call to getIndexInfo: index exists with docs
      // Second call (after drop) for collectionExists check: index doesn't exist
      let infoCallCount = 0
      mockFtInfo.mockImplementation(() => {
        infoCallCount++
        if (infoCallCount <= 2) {
          // First two calls: index exists (getIndexInfo + collectionExists in initialize)
          return Promise.resolve({
            fields: [
              {
                type: "VECTOR",
                vector_params: { dimension: TEST_VECTOR_SIZE },
              },
            ],
            num_docs: 10,
          })
        }
        // After drop: collectionExists check for createIndex pre-validation
        throw new MockRequestError("Unknown index name")
      })

      // No metadata stored
      mockHgetall.mockImplementation(() => Promise.resolve([]))

      // Scan returns no keys (already cleaned up by dropindex)
      mockScan.mockImplementation(() => Promise.resolve(["0", []]))

      const result = await store.initialize()

      expect(result).toBe(true)
      expect(mockFtDropindex).toHaveBeenCalledTimes(1)
      expect(mockFtCreate).toHaveBeenCalledTimes(1)
    })

    test("drops and recreates index when stored profile differs from current", async () => {
      const store = createStore(TEST_PROFILE)

      let infoCallCount = 0
      mockFtInfo.mockImplementation(() => {
        infoCallCount++
        if (infoCallCount <= 2) {
          return Promise.resolve({
            fields: [
              {
                type: "VECTOR",
                vector_params: { dimension: TEST_VECTOR_SIZE },
              },
            ],
            num_docs: 5,
          })
        }
        // After drop: index doesn't exist
        throw new MockRequestError("Unknown index name")
      })

      // Metadata returns a different profile (ollama instead of openai)
      mockHgetall.mockImplementation(() =>
        Promise.resolve([
          { field: "type", value: "metadata" },
          { field: "indexing_complete", value: "true" },
          { field: "embedding_provider", value: "ollama" },
          { field: "embedding_model_id", value: "nomic-embed-text" },
          { field: "embedding_dimension", value: "768" },
        ]),
      )

      mockScan.mockImplementation(() => Promise.resolve(["0", []]))

      const result = await store.initialize()

      expect(result).toBe(true)
      expect(mockFtDropindex).toHaveBeenCalledTimes(1)
      expect(mockFtCreate).toHaveBeenCalledTimes(1)
    })

    test("drops and recreates index when dimension does not match", async () => {
      const store = createStore(TEST_PROFILE)

      let infoCallCount = 0
      mockFtInfo.mockImplementation(() => {
        infoCallCount++
        if (infoCallCount <= 2) {
          // Index exists with WRONG dimension (768 instead of 1536)
          return Promise.resolve({
            fields: [
              {
                type: "VECTOR",
                vector_params: { dimension: 768 },
              },
            ],
            num_docs: 3,
          })
        }
        // After drop: index doesn't exist
        throw new MockRequestError("Unknown index name")
      })

      mockScan.mockImplementation(() => Promise.resolve(["0", []]))

      const result = await store.initialize()

      expect(result).toBe(true)
      expect(mockFtDropindex).toHaveBeenCalledTimes(1)
      expect(mockFtCreate).toHaveBeenCalledTimes(1)
    })
  })

  describe("createIndex()", () => {
    test("creates index with correct schema (VECTOR HNSW COSINE, TAG fields, prefix)", async () => {
      const store = createStore(TEST_PROFILE)

      // collectionExists check: index doesn't exist
      mockFtInfo.mockImplementation(() => {
        throw new MockRequestError("Unknown index name")
      })

      await store.createIndex()

      expect(mockFtCreate).toHaveBeenCalledTimes(1)

      const [, indexName, schema, options] = mockFtCreate.mock.calls[0]

      // Verify index name
      expect(indexName).toBe(expectedCollectionName)

      // Verify schema has VECTOR field with correct attributes
      const vectorField = schema.find((f: any) => f.type === "VECTOR")
      expect(vectorField).toBeDefined()
      expect(vectorField.name).toBe("vector")
      expect(vectorField.attributes.algorithm).toBe("HNSW")
      expect(vectorField.attributes.type).toBe("FLOAT32")
      expect(vectorField.attributes.dimensions).toBe(TEST_VECTOR_SIZE)
      expect(vectorField.attributes.distanceMetric).toBe("COSINE")

      // Verify TAG fields
      const tagFields = schema.filter((f: any) => f.type === "TAG")
      const tagNames = tagFields.map((f: any) => f.name)
      expect(tagNames).toContain("seg0")
      expect(tagNames).toContain("seg1")
      expect(tagNames).toContain("seg2")
      expect(tagNames).toContain("seg3")
      expect(tagNames).toContain("seg4")
      expect(tagNames).toContain("filePath")
      expect(tagNames).toContain("type")

      // Verify options
      expect(options.dataType).toBe("HASH")
      expect(options.prefixes).toEqual([`${expectedCollectionName}:`])
    })

    test("throws if index already exists (pre-validation)", async () => {
      const store = createStore(TEST_PROFILE)

      // collectionExists check: index exists
      mockFtInfo.mockImplementation(() =>
        Promise.resolve({
          fields: [],
          num_docs: 0,
        }),
      )

      await expect(store.createIndex()).rejects.toThrow(`Index ${expectedCollectionName} already exists`)
      expect(mockFtCreate).not.toHaveBeenCalled()
    })
  })

  describe("dropIndex()", () => {
    test("calls GlideFt.dropindex() and scanAndDelete when index exists", async () => {
      const store = createStore(TEST_PROFILE)

      // collectionExists: index exists
      mockFtInfo.mockImplementation(() =>
        Promise.resolve({
          fields: [],
          num_docs: 0,
        }),
      )

      // Scan returns some keys then completes
      let scanCallCount = 0
      mockScan.mockImplementation(() => {
        scanCallCount++
        if (scanCallCount === 1) {
          return Promise.resolve(["0", [`${expectedCollectionName}:point1`, `${expectedCollectionName}:point2`]])
        }
        return Promise.resolve(["0", []])
      })

      await store.dropIndex()

      expect(mockFtDropindex).toHaveBeenCalledTimes(1)
      expect(mockFtDropindex).toHaveBeenCalledWith(mockClientInstance, expectedCollectionName)
      expect(mockDel).toHaveBeenCalled()
    })

    test("returns silently if index does not exist (pre-validation)", async () => {
      const store = createStore(TEST_PROFILE)

      // collectionExists: index doesn't exist
      mockFtInfo.mockImplementation(() => {
        throw new MockRequestError("Unknown index name")
      })

      await store.dropIndex()

      expect(mockFtDropindex).not.toHaveBeenCalled()
      expect(mockDel).not.toHaveBeenCalled()
    })

    test("scanAndDelete iterates through multiple cursor pages", async () => {
      const store = createStore(TEST_PROFILE)

      // collectionExists: index exists
      mockFtInfo.mockImplementation(() =>
        Promise.resolve({
          fields: [],
          num_docs: 0,
        }),
      )

      // Simulate multi-page scan
      let scanCallCount = 0
      mockScan.mockImplementation(() => {
        scanCallCount++
        if (scanCallCount === 1) {
          return Promise.resolve(["42", [`${expectedCollectionName}:point1`]])
        }
        if (scanCallCount === 2) {
          return Promise.resolve(["0", [`${expectedCollectionName}:point2`]])
        }
        return Promise.resolve(["0", []])
      })

      await store.dropIndex()

      // Should have called del twice (once per scan batch with keys)
      expect(mockDel).toHaveBeenCalledTimes(2)
    })
  })

  describe("collectionExists()", () => {
    test("returns true when GlideFt.info() succeeds", async () => {
      const store = createStore(TEST_PROFILE)

      mockFtInfo.mockImplementation(() =>
        Promise.resolve({
          fields: [],
          num_docs: 0,
        }),
      )

      const result = await store.collectionExists()
      expect(result).toBe(true)
    })

    test("returns false when GlideFt.info() throws RequestError", async () => {
      const store = createStore(TEST_PROFILE)

      mockFtInfo.mockImplementation(() => {
        throw new MockRequestError("Unknown index name")
      })

      const result = await store.collectionExists()
      expect(result).toBe(false)
    })

    test("re-throws non-RequestError errors", async () => {
      const store = createStore(TEST_PROFILE)

      mockFtInfo.mockImplementation(() => {
        throw new Error("Network failure")
      })

      await expect(store.collectionExists()).rejects.toThrow("Network failure")
    })
  })

  describe("getIndexInfo()", () => {
    test("returns index info when index exists", async () => {
      const store = createStore(TEST_PROFILE)

      const expectedInfo = {
        fields: [{ type: "VECTOR", vector_params: { dimension: 1536 } }],
        num_docs: 10,
      }
      mockFtInfo.mockImplementation(() => Promise.resolve(expectedInfo))

      const result = await store.getIndexInfo()
      expect(result).toEqual(expectedInfo)
    })

    test("returns null when index does not exist (RequestError)", async () => {
      const store = createStore(TEST_PROFILE)

      mockFtInfo.mockImplementation(() => {
        throw new MockRequestError("Unknown index name")
      })

      const result = await store.getIndexInfo()
      expect(result).toBeNull()
    })

    test("re-throws non-RequestError errors", async () => {
      const store = createStore(TEST_PROFILE)

      mockFtInfo.mockImplementation(() => {
        throw new Error("Connection lost")
      })

      await expect(store.getIndexInfo()).rejects.toThrow("Connection lost")
    })
  })

  describe("upsertPoints() edge cases", () => {
    test("does not connect or create batch when given empty array", async () => {
      const store = createStore(TEST_PROFILE)

      await store.upsertPoints([])

      expect(mockCreateClient).not.toHaveBeenCalled()
      expect(mockExec).not.toHaveBeenCalled()
    })
  })

  describe("Connection recovery after handleClientError()", () => {
    test("reconnects on next operation after a ClosingError nulls the client", async () => {
      const store = createStore(TEST_PROFILE)

      mockFtInfo.mockImplementation(() => {
        throw new MockRequestError("Unknown index name")
      })
      await store.initialize()

      mockCreateClient.mockClear()
      mockCreateClient.mockImplementation(() => Promise.resolve(mockClientInstance))

      // ClosingError triggers handleClientError → nulls client
      mockFtInfo.mockImplementation(() => Promise.resolve({ fields: [], num_docs: 5 }))
      mockFtSearch.mockImplementation(() => {
        throw new MockClosingError("Connection closed unexpectedly")
      })

      const queryVector = Array(TEST_VECTOR_SIZE).fill(0.1)
      await expect(store.search(queryVector)).rejects.toThrow("Connection closed unexpectedly")

      mockFtInfo.mockImplementation(() => Promise.resolve({ fields: [], num_docs: 5 }))
      mockFtSearch.mockImplementation(() => Promise.resolve([0, []]))

      const results = await store.search(queryVector)
      expect(results).toEqual([])
      expect(mockCreateClient).toHaveBeenCalledTimes(1)
    })

    test("does NOT reconnect after a generic Error (client remains set)", async () => {
      const store = createStore(TEST_PROFILE)

      mockFtInfo.mockImplementation(() => {
        throw new MockRequestError("Unknown index name")
      })
      await store.initialize()

      mockCreateClient.mockClear()
      mockCreateClient.mockImplementation(() => Promise.resolve(mockClientInstance))

      // Generic errors do NOT null the client — only ClosingError does
      mockFtInfo.mockImplementation(() => Promise.resolve({ fields: [], num_docs: 5 }))
      mockFtSearch.mockImplementation(() => {
        throw new Error("Timeout exceeded")
      })

      const queryVector = Array(TEST_VECTOR_SIZE).fill(0.1)
      await expect(store.search(queryVector)).rejects.toThrow("Timeout exceeded")

      mockFtSearch.mockImplementation(() => Promise.resolve([0, []]))

      const results = await store.search(queryVector)
      expect(results).toEqual([])
      expect(mockCreateClient).not.toHaveBeenCalled()
    })
  })

  describe("initialize() when server is unreachable", () => {
    test("throws when GlideClient.createClient rejects", async () => {
      const store = createStore(TEST_PROFILE)

      mockCreateClient.mockImplementation(() =>
        Promise.reject(new Error("Connection refused: ECONNREFUSED 192.0.2.1:6379")),
      )

      await expect(store.initialize()).rejects.toThrow("Connection refused")
    })
  })

  describe("clearCollection() MAX_SCAN_ITERATIONS safety valve", () => {
    test("breaks out of scan loop after max iterations without infinite looping", async () => {
      const store = createStore(TEST_PROFILE)

      mockFtInfo.mockImplementation(() => {
        throw new MockRequestError("Unknown index name")
      })
      await store.initialize()

      mockFtInfo.mockImplementation(() => Promise.resolve({ fields: [], num_docs: 100 }))

      // Scan never completes — always returns non-zero cursor
      let scanCallCount = 0
      mockScan.mockImplementation(() => {
        scanCallCount++
        return Promise.resolve(["1", [`${expectedCollectionName}:key-${scanCallCount}`]])
      })
      mockDel.mockImplementation(() => Promise.resolve(1))

      await store.clearCollection()

      expect(scanCallCount).toBeGreaterThan(0)
      expect(scanCallCount).toBeLessThanOrEqual(100_001)
    }, 30000)
  })
})
