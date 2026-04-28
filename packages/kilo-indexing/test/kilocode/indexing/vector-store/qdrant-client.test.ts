import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"

import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE } from "../../../../src/indexing/constants"

// Set up mocks BEFORE importing modules that use them
const mockGetCollection = mock()
const mockCreateCollection = mock()
const mockDeleteCollection = mock()
const mockCreatePayloadIndex = mock()
const mockUpsert = mock()
const mockQuery = mock()
const mockDelete = mock()
const mockRetrieve = mock()

const mockQdrantClientInstance = {
  getCollection: mockGetCollection,
  createCollection: mockCreateCollection,
  deleteCollection: mockDeleteCollection,
  createPayloadIndex: mockCreatePayloadIndex,
  upsert: mockUpsert,
  query: mockQuery,
  delete: mockDelete,
  retrieve: mockRetrieve,
}

const MockQdrantClientConstructor = mock(() => mockQdrantClientInstance)

mock.module("@qdrant/js-client-rest", () => ({
  QdrantClient: MockQdrantClientConstructor,
}))

const mockDigest = mock()
const mockUpdate = mock(() => ({ update: mockUpdate, digest: mockDigest }))
const mockCreateHash = mock(() => ({ update: mockUpdate, digest: mockDigest }))

mock.module("crypto", () => ({
  createHash: mockCreateHash,
}))

// Now import the module under test
import { QdrantVectorStore } from "../../../../src/indexing/vector-store/qdrant-client"

describe("QdrantVectorStore", () => {
  let vectorStore: QdrantVectorStore
  const mockWorkspacePath = "/test/workspace"
  const mockQdrantUrl = "http://mock-qdrant:6333"
  const mockApiKey = "test-api-key"
  const mockVectorSize = 1536
  const mockHashedPath = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
  const expectedCollectionName = `ws-${mockHashedPath.substring(0, 16)}`

  beforeEach(() => {
    // Reset all mocks
    MockQdrantClientConstructor.mockClear()
    MockQdrantClientConstructor.mockReturnValue(mockQdrantClientInstance)
    mockGetCollection.mockReset()
    mockCreateCollection.mockReset()
    mockDeleteCollection.mockReset()
    mockCreatePayloadIndex.mockReset()
    mockUpsert.mockReset()
    mockQuery.mockReset()
    mockDelete.mockReset()
    mockRetrieve.mockReset()
    mockCreateHash.mockReset()
    mockUpdate.mockReset()
    mockDigest.mockReset()

    // Mock crypto.createHash chain
    mockCreateHash.mockReturnValue({ update: mockUpdate, digest: mockDigest })
    mockUpdate.mockReturnValue({ update: mockUpdate, digest: mockDigest })
    mockDigest.mockReturnValue(mockHashedPath)

    vectorStore = new QdrantVectorStore(mockWorkspacePath, mockQdrantUrl, mockVectorSize, mockApiKey)
  })

  afterEach(() => {
    MockQdrantClientConstructor.mockClear()
    mockGetCollection.mockReset()
    mockCreateCollection.mockReset()
    mockDeleteCollection.mockReset()
    mockCreatePayloadIndex.mockReset()
    mockUpsert.mockReset()
    mockQuery.mockReset()
    mockDelete.mockReset()
    mockRetrieve.mockReset()
    mockCreateHash.mockReset()
    mockUpdate.mockReset()
    mockDigest.mockReset()
  })

  test("should correctly initialize QdrantClient and collectionName in constructor", () => {
    expect(MockQdrantClientConstructor).toHaveBeenCalledTimes(1)
    expect(MockQdrantClientConstructor).toHaveBeenCalledWith({
      host: "mock-qdrant",
      https: false,
      port: 6333,
      apiKey: mockApiKey,
      headers: {
        "User-Agent": "Kilo-Code",
      },
    })
    expect(mockCreateHash).toHaveBeenCalledWith("sha256")
    expect(mockUpdate).toHaveBeenCalledWith(mockWorkspacePath)
    expect(mockDigest).toHaveBeenCalledWith("hex")
    expect((vectorStore as any).collectionName).toBe(expectedCollectionName)
    expect((vectorStore as any).vectorSize).toBe(mockVectorSize)
  })

  test("should handle constructor with default URL when none provided", () => {
    const vectorStoreWithDefaults = new QdrantVectorStore(mockWorkspacePath, undefined as any, mockVectorSize)

    expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
      host: "localhost",
      https: false,
      port: 6333,
      apiKey: undefined,
      headers: {
        "User-Agent": "Kilo-Code",
      },
    })
  })

  test("should handle constructor without API key", () => {
    const vectorStoreWithoutKey = new QdrantVectorStore(mockWorkspacePath, mockQdrantUrl, mockVectorSize)

    expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
      host: "mock-qdrant",
      https: false,
      port: 6333,
      apiKey: undefined,
      headers: {
        "User-Agent": "Kilo-Code",
      },
    })
  })

  describe("URL Parsing and Explicit Port Handling", () => {
    describe("HTTPS URL handling", () => {
      test("should use explicit port 443 for HTTPS URLs without port (fixes the main bug)", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "https://qdrant.ashbyfam.com", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "qdrant.ashbyfam.com",
          https: true,
          port: 443,
          prefix: undefined,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("https://qdrant.ashbyfam.com")
      })

      test("should use explicit port for HTTPS URLs with explicit port", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "https://example.com:9000", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "example.com",
          https: true,
          port: 9000,
          prefix: undefined,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("https://example.com:9000")
      })

      test("should use port 443 for HTTPS URLs with paths and query parameters", () => {
        const vectorStore = new QdrantVectorStore(
          mockWorkspacePath,
          "https://example.com/api/v1?key=value",
          mockVectorSize,
        )
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "example.com",
          https: true,
          port: 443,
          prefix: "/api/v1",
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("https://example.com/api/v1?key=value")
      })
    })

    describe("HTTP URL handling", () => {
      test("should use explicit port 80 for HTTP URLs without port", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "http://example.com", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "example.com",
          https: false,
          port: 80,
          prefix: undefined,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://example.com")
      })

      test("should use explicit port for HTTP URLs with explicit port", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "http://localhost:8080", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "localhost",
          https: false,
          port: 8080,
          prefix: undefined,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://localhost:8080")
      })

      test("should use port 80 for HTTP URLs while preserving paths and query parameters", () => {
        const vectorStore = new QdrantVectorStore(
          mockWorkspacePath,
          "http://example.com/api/v1?key=value",
          mockVectorSize,
        )
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "example.com",
          https: false,
          port: 80,
          prefix: "/api/v1",
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://example.com/api/v1?key=value")
      })
    })

    describe("Hostname handling", () => {
      test("should convert hostname to http with port 80", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "qdrant.example.com", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "qdrant.example.com",
          https: false,
          port: 80,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://qdrant.example.com")
      })

      test("should handle hostname:port format with explicit port", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "localhost:6333", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "localhost",
          https: false,
          port: 6333,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://localhost:6333")
      })

      test("should handle explicit HTTP URLs correctly", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "http://localhost:9000", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "localhost",
          https: false,
          port: 9000,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://localhost:9000")
      })
    })

    describe("IP address handling", () => {
      test("should convert IP address to http with port 80", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "192.168.1.100", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "192.168.1.100",
          https: false,
          port: 80,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://192.168.1.100")
      })

      test("should handle IP:port format with explicit port", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "192.168.1.100:6333", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "192.168.1.100",
          https: false,
          port: 6333,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://192.168.1.100:6333")
      })
    })

    describe("Edge cases", () => {
      test("should handle undefined URL with host-based config", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, undefined as any, mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "localhost",
          https: false,
          port: 6333,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://localhost:6333")
      })

      test("should handle empty string URL with host-based config", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "localhost",
          https: false,
          port: 6333,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://localhost:6333")
      })

      test("should handle whitespace-only URL with host-based config", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "   ", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "localhost",
          https: false,
          port: 6333,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://localhost:6333")
      })
    })

    describe("Invalid URL fallback", () => {
      test("should treat invalid URLs as hostnames with port 80", () => {
        const vectorStore = new QdrantVectorStore(mockWorkspacePath, "invalid-url-format", mockVectorSize)
        expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
          host: "invalid-url-format",
          https: false,
          port: 80,
          apiKey: undefined,
          headers: {
            "User-Agent": "Kilo-Code",
          },
        })
        expect((vectorStore as any).qdrantUrl).toBe("http://invalid-url-format")
      })
    })
  })

  describe("URL Prefix Handling", () => {
    test("should pass the URL pathname as prefix to QdrantClient if not root", () => {
      const vectorStoreWithPrefix = new QdrantVectorStore(
        mockWorkspacePath,
        "http://localhost:6333/some/path",
        mockVectorSize,
      )
      expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
        host: "localhost",
        https: false,
        port: 6333,
        prefix: "/some/path",
        apiKey: undefined,
        headers: {
          "User-Agent": "Kilo-Code",
        },
      })
      expect((vectorStoreWithPrefix as any).qdrantUrl).toBe("http://localhost:6333/some/path")
    })

    test("should not pass prefix if the URL pathname is root ('/')", () => {
      const vectorStoreWithoutPrefix = new QdrantVectorStore(
        mockWorkspacePath,
        "http://localhost:6333/",
        mockVectorSize,
      )
      expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
        host: "localhost",
        https: false,
        port: 6333,
        prefix: undefined,
        apiKey: undefined,
        headers: {
          "User-Agent": "Kilo-Code",
        },
      })
      expect((vectorStoreWithoutPrefix as any).qdrantUrl).toBe("http://localhost:6333/")
    })

    test("should handle HTTPS URL with path as prefix", () => {
      const vectorStoreWithHttpsPrefix = new QdrantVectorStore(
        mockWorkspacePath,
        "https://qdrant.ashbyfam.com/api",
        mockVectorSize,
      )
      expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
        host: "qdrant.ashbyfam.com",
        https: true,
        port: 443,
        prefix: "/api",
        apiKey: undefined,
        headers: {
          "User-Agent": "Kilo-Code",
        },
      })
      expect((vectorStoreWithHttpsPrefix as any).qdrantUrl).toBe("https://qdrant.ashbyfam.com/api")
    })

    test("should normalize URL pathname by removing trailing slash for prefix", () => {
      const vectorStoreWithTrailingSlash = new QdrantVectorStore(
        mockWorkspacePath,
        "http://localhost:6333/api/",
        mockVectorSize,
      )
      expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
        host: "localhost",
        https: false,
        port: 6333,
        prefix: "/api",
        apiKey: undefined,
        headers: {
          "User-Agent": "Kilo-Code",
        },
      })
      expect((vectorStoreWithTrailingSlash as any).qdrantUrl).toBe("http://localhost:6333/api/")
    })

    test("should normalize URL pathname by removing multiple trailing slashes for prefix", () => {
      const vectorStoreWithMultipleTrailingSlashes = new QdrantVectorStore(
        mockWorkspacePath,
        "http://localhost:6333/api///",
        mockVectorSize,
      )
      expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
        host: "localhost",
        https: false,
        port: 6333,
        prefix: "/api",
        apiKey: undefined,
        headers: {
          "User-Agent": "Kilo-Code",
        },
      })
      expect((vectorStoreWithMultipleTrailingSlashes as any).qdrantUrl).toBe("http://localhost:6333/api///")
    })

    test("should handle multiple path segments correctly for prefix", () => {
      const vectorStoreWithMultiSegment = new QdrantVectorStore(
        mockWorkspacePath,
        "http://localhost:6333/api/v1/qdrant",
        mockVectorSize,
      )
      expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
        host: "localhost",
        https: false,
        port: 6333,
        prefix: "/api/v1/qdrant",
        apiKey: undefined,
        headers: {
          "User-Agent": "Kilo-Code",
        },
      })
      expect((vectorStoreWithMultiSegment as any).qdrantUrl).toBe("http://localhost:6333/api/v1/qdrant")
    })

    test("should handle complex URL with multiple segments, multiple trailing slashes, query params, and fragment", () => {
      const complexUrl = "https://example.com/ollama/api/v1///?key=value#pos"
      const vectorStoreComplex = new QdrantVectorStore(mockWorkspacePath, complexUrl, mockVectorSize)
      expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
        host: "example.com",
        https: true,
        port: 443,
        prefix: "/ollama/api/v1",
        apiKey: undefined,
        headers: {
          "User-Agent": "Kilo-Code",
        },
      })
      expect((vectorStoreComplex as any).qdrantUrl).toBe(complexUrl)
    })

    test("should ignore query parameters and fragments when determining prefix", () => {
      const vectorStoreWithQueryParams = new QdrantVectorStore(
        mockWorkspacePath,
        "http://localhost:6333/api/path?key=value#fragment",
        mockVectorSize,
      )
      expect(MockQdrantClientConstructor).toHaveBeenLastCalledWith({
        host: "localhost",
        https: false,
        port: 6333,
        prefix: "/api/path",
        apiKey: undefined,
        headers: {
          "User-Agent": "Kilo-Code",
        },
      })
      expect((vectorStoreWithQueryParams as any).qdrantUrl).toBe("http://localhost:6333/api/path?key=value#fragment")
    })
  })

  describe("initialize", () => {
    test("should create a new collection if none exists and return true", async () => {
      mockGetCollection.mockRejectedValue({
        response: { status: 404 },
        message: "Not found",
      })
      mockCreateCollection.mockResolvedValue(true as any)
      mockCreatePayloadIndex.mockResolvedValue({} as any)

      const result = await vectorStore.initialize()

      expect(result).toBe(true)
      expect(mockGetCollection).toHaveBeenCalledTimes(1)
      expect(mockGetCollection).toHaveBeenCalledWith(expectedCollectionName)
      expect(mockCreateCollection).toHaveBeenCalledTimes(1)
      expect(mockCreateCollection).toHaveBeenCalledWith(expectedCollectionName, {
        vectors: {
          size: mockVectorSize,
          distance: "Cosine",
          on_disk: true,
        },
        hnsw_config: {
          m: 64,
          ef_construct: 512,
          on_disk: true,
        },
      })
      expect(mockDeleteCollection).not.toHaveBeenCalled()

      expect(mockCreatePayloadIndex).toHaveBeenCalledWith(expectedCollectionName, {
        field_name: "type",
        field_schema: "keyword",
      })
      for (let i = 0; i <= 4; i++) {
        expect(mockCreatePayloadIndex).toHaveBeenCalledWith(expectedCollectionName, {
          field_name: `pathSegments.${i}`,
          field_schema: "keyword",
        })
      }
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(6)
    })

    test("should not create a new collection if one exists with matching vectorSize and return false", async () => {
      mockGetCollection.mockResolvedValue({
        config: {
          params: {
            vectors: {
              size: mockVectorSize,
            },
          },
        },
      } as any)
      mockCreatePayloadIndex.mockResolvedValue({} as any)

      const result = await vectorStore.initialize()

      expect(result).toBe(false)
      expect(mockGetCollection).toHaveBeenCalledTimes(1)
      expect(mockGetCollection).toHaveBeenCalledWith(expectedCollectionName)
      expect(mockCreateCollection).not.toHaveBeenCalled()
      expect(mockDeleteCollection).not.toHaveBeenCalled()

      expect(mockCreatePayloadIndex).toHaveBeenCalledWith(expectedCollectionName, {
        field_name: "type",
        field_schema: "keyword",
      })
      for (let i = 0; i <= 4; i++) {
        expect(mockCreatePayloadIndex).toHaveBeenCalledWith(expectedCollectionName, {
          field_name: `pathSegments.${i}`,
          field_schema: "keyword",
        })
      }
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(6)
    })

    test("should recreate collection when stored embedding identity mismatches", async () => {
      const identity = {
        provider: "openai",
        modelId: "text-embedding-3-small",
        dimension: mockVectorSize,
      }
      const store = new (QdrantVectorStore as any)(
        mockWorkspacePath,
        mockQdrantUrl,
        mockVectorSize,
        mockApiKey,
        identity,
      )

      mockGetCollection
        .mockResolvedValueOnce({
          points_count: 7,
          config: {
            params: {
              vectors: {
                size: mockVectorSize,
              },
            },
          },
        } as any)
        .mockRejectedValueOnce({
          response: { status: 404 },
          message: "Not found",
        })
      mockRetrieve.mockResolvedValue([
        {
          payload: {
            indexing_complete: true,
            embedding_provider: "ollama",
            embedding_model_id: "nomic-embed-text",
            embedding_dimension: 768,
          },
        },
      ] as any)
      mockDeleteCollection.mockResolvedValue(true as any)
      mockCreateCollection.mockResolvedValue(true as any)
      mockCreatePayloadIndex.mockResolvedValue({} as any)

      const result = await store.initialize()

      expect(result).toBe(true)
      expect(mockRetrieve).toHaveBeenCalledTimes(1)
      expect(mockDeleteCollection).toHaveBeenCalledTimes(1)
      expect(mockCreateCollection).toHaveBeenCalledTimes(1)
    })

    test("should recreate populated legacy collection when identity metadata is missing", async () => {
      const identity = {
        provider: "openai",
        modelId: "text-embedding-3-small",
        dimension: mockVectorSize,
      }
      const store = new (QdrantVectorStore as any)(
        mockWorkspacePath,
        mockQdrantUrl,
        mockVectorSize,
        mockApiKey,
        identity,
      )

      mockGetCollection
        .mockResolvedValueOnce({
          points_count: 12,
          config: {
            params: {
              vectors: {
                size: mockVectorSize,
              },
            },
          },
        } as any)
        .mockRejectedValueOnce({
          response: { status: 404 },
          message: "Not found",
        })
      mockRetrieve.mockResolvedValue([
        {
          payload: {
            indexing_complete: true,
          },
        },
      ] as any)
      mockDeleteCollection.mockResolvedValue(true as any)
      mockCreateCollection.mockResolvedValue(true as any)
      mockCreatePayloadIndex.mockResolvedValue({} as any)

      const result = await store.initialize()

      expect(result).toBe(true)
      expect(mockRetrieve).toHaveBeenCalledTimes(1)
      expect(mockDeleteCollection).toHaveBeenCalledTimes(1)
      expect(mockCreateCollection).toHaveBeenCalledTimes(1)
    })

    test("should recreate collection if it exists but vectorSize mismatches and return true", async () => {
      const differentVectorSize = 768
      mockGetCollection
        .mockResolvedValueOnce({
          config: {
            params: {
              vectors: {
                size: differentVectorSize,
              },
            },
          },
        } as any)
        .mockRejectedValueOnce({
          response: { status: 404 },
          message: "Not found",
        })
      mockDeleteCollection.mockResolvedValue(true as any)
      mockCreateCollection.mockResolvedValue(true as any)
      mockCreatePayloadIndex.mockResolvedValue({} as any)

      const result = await vectorStore.initialize()

      expect(result).toBe(true)
      expect(mockGetCollection).toHaveBeenCalledTimes(2)
      expect(mockGetCollection).toHaveBeenCalledWith(expectedCollectionName)
      expect(mockDeleteCollection).toHaveBeenCalledTimes(1)
      expect(mockDeleteCollection).toHaveBeenCalledWith(expectedCollectionName)
      expect(mockCreateCollection).toHaveBeenCalledTimes(1)
      expect(mockCreateCollection).toHaveBeenCalledWith(expectedCollectionName, {
        vectors: {
          size: mockVectorSize,
          distance: "Cosine",
          on_disk: true,
        },
        hnsw_config: {
          m: 64,
          ef_construct: 512,
          on_disk: true,
        },
      })

      expect(mockCreatePayloadIndex).toHaveBeenCalledWith(expectedCollectionName, {
        field_name: "type",
        field_schema: "keyword",
      })
      for (let i = 0; i <= 4; i++) {
        expect(mockCreatePayloadIndex).toHaveBeenCalledWith(expectedCollectionName, {
          field_name: `pathSegments.${i}`,
          field_schema: "keyword",
        })
      }
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(6)
    })

    test("should log warning for non-404 errors but still create collection", async () => {
      const genericError = new Error("Generic Qdrant Error")
      mockGetCollection.mockRejectedValue(genericError)
      mockCreateCollection.mockResolvedValue(true as any)
      mockCreatePayloadIndex.mockResolvedValue({} as any)

      const result = await vectorStore.initialize()

      expect(result).toBe(true)
      expect(mockGetCollection).toHaveBeenCalledTimes(1)
      expect(mockCreateCollection).toHaveBeenCalledTimes(1)
      expect(mockDeleteCollection).not.toHaveBeenCalled()
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(6)
    })

    test("should re-throw error from createCollection when no collection initially exists", async () => {
      mockGetCollection.mockRejectedValue({
        response: { status: 404 },
        message: "Not found",
      })
      const createError = new Error("Create Collection Failed")
      mockCreateCollection.mockRejectedValue(createError)

      await expect(vectorStore.initialize()).rejects.toThrow(/Failed to connect to Qdrant at/)

      expect(mockGetCollection).toHaveBeenCalledTimes(1)
      expect(mockCreateCollection).toHaveBeenCalledTimes(1)
      expect(mockDeleteCollection).not.toHaveBeenCalled()
      expect(mockCreatePayloadIndex).not.toHaveBeenCalled()
    })

    test("should log but not fail if payload index creation errors occur", async () => {
      mockGetCollection.mockRejectedValue({
        response: { status: 404 },
        message: "Not found",
      })
      mockCreateCollection.mockResolvedValue(true as any)

      const indexError = new Error("Index creation failed")
      mockCreatePayloadIndex.mockRejectedValue(indexError)

      const result = await vectorStore.initialize()

      expect(result).toBe(true)
      expect(mockCreateCollection).toHaveBeenCalledTimes(1)

      // All payload index creations should be attempted (6: type + 5 pathSegments)
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(6)
    })

    test("should throw vectorDimensionMismatch error when deleteCollection fails during recreation", async () => {
      const differentVectorSize = 768
      mockGetCollection.mockResolvedValue({
        config: {
          params: {
            vectors: {
              size: differentVectorSize,
            },
          },
        },
      } as any)

      const deleteError = new Error("Delete Collection Failed")
      mockDeleteCollection.mockRejectedValue(deleteError)

      let caughtError: any
      try {
        await vectorStore.initialize()
      } catch (error: any) {
        caughtError = error
      }

      expect(caughtError).toBeDefined()
      expect(caughtError.message).toContain("Vector dimension mismatch")
      expect(caughtError.cause).toBe(deleteError)

      expect(mockGetCollection).toHaveBeenCalledTimes(1)
      expect(mockDeleteCollection).toHaveBeenCalledTimes(1)
      expect(mockCreateCollection).not.toHaveBeenCalled()
      expect(mockCreatePayloadIndex).not.toHaveBeenCalled()
    })

    test("should throw vectorDimensionMismatch error when createCollection fails during recreation", async () => {
      const differentVectorSize = 768
      mockGetCollection
        .mockResolvedValueOnce({
          config: {
            params: {
              vectors: {
                size: differentVectorSize,
              },
            },
          },
        } as any)
        .mockRejectedValueOnce({
          response: { status: 404 },
          message: "Not found",
        })

      mockDeleteCollection.mockResolvedValue(true as any)
      const createError = new Error("Create Collection Failed")
      mockCreateCollection.mockRejectedValue(createError)

      let caughtError: any
      try {
        await vectorStore.initialize()
      } catch (error: any) {
        caughtError = error
      }

      expect(caughtError).toBeDefined()
      expect(caughtError.message).toContain("Vector dimension mismatch")
      expect(caughtError.cause).toBe(createError)

      expect(mockGetCollection).toHaveBeenCalledTimes(2)
      expect(mockDeleteCollection).toHaveBeenCalledTimes(1)
      expect(mockCreateCollection).toHaveBeenCalledTimes(1)
      expect(mockCreatePayloadIndex).not.toHaveBeenCalled()
    })

    test("should verify collection deletion before proceeding with recreation", async () => {
      const differentVectorSize = 768
      mockGetCollection
        .mockResolvedValueOnce({
          config: {
            params: {
              vectors: {
                size: differentVectorSize,
              },
            },
          },
        } as any)
        .mockRejectedValueOnce({
          response: { status: 404 },
          message: "Not found",
        })

      mockDeleteCollection.mockResolvedValue(true as any)
      mockCreateCollection.mockResolvedValue(true as any)
      mockCreatePayloadIndex.mockResolvedValue({} as any)

      const result = await vectorStore.initialize()

      expect(result).toBe(true)
      // Should call getCollection twice: once to check existing, once to verify deletion
      expect(mockGetCollection).toHaveBeenCalledTimes(2)
      expect(mockDeleteCollection).toHaveBeenCalledTimes(1)
      expect(mockCreateCollection).toHaveBeenCalledTimes(1)
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(6)
    })

    test("should throw error if collection still exists after deletion attempt", async () => {
      const differentVectorSize = 768
      mockGetCollection
        .mockResolvedValueOnce({
          config: {
            params: {
              vectors: {
                size: differentVectorSize,
              },
            },
          },
        } as any)
        // Second call should still return the collection (deletion failed)
        .mockResolvedValueOnce({
          config: {
            params: {
              vectors: {
                size: differentVectorSize,
              },
            },
          },
        } as any)

      mockDeleteCollection.mockResolvedValue(true as any)

      let caughtError: any
      try {
        await vectorStore.initialize()
      } catch (error: any) {
        caughtError = error
      }

      expect(caughtError).toBeDefined()
      expect(caughtError.message).toContain("Vector dimension mismatch")
      expect(caughtError.message).toContain("Deleted existing collection but failed verification step")

      expect(mockGetCollection).toHaveBeenCalledTimes(2)
      expect(mockDeleteCollection).toHaveBeenCalledTimes(1)
      expect(mockCreateCollection).not.toHaveBeenCalled()
      expect(mockCreatePayloadIndex).not.toHaveBeenCalled()
    })

    test("should handle dimension mismatch scenario from 2048 to 768 dimensions", async () => {
      const oldVectorSize = 2048
      const newVectorSize = 768

      const newVectorStore = new QdrantVectorStore(mockWorkspacePath, mockQdrantUrl, newVectorSize, mockApiKey)

      mockGetCollection
        .mockResolvedValueOnce({
          config: {
            params: {
              vectors: {
                size: oldVectorSize,
              },
            },
          },
        } as any)
        .mockRejectedValueOnce({
          response: { status: 404 },
          message: "Not found",
        })

      mockDeleteCollection.mockResolvedValue(true as any)
      mockCreateCollection.mockResolvedValue(true as any)
      mockCreatePayloadIndex.mockResolvedValue({} as any)

      const result = await newVectorStore.initialize()

      expect(result).toBe(true)
      expect(mockGetCollection).toHaveBeenCalledTimes(2)
      expect(mockDeleteCollection).toHaveBeenCalledTimes(1)
      expect(mockCreateCollection).toHaveBeenCalledWith(expectedCollectionName, {
        vectors: {
          size: newVectorSize,
          distance: "Cosine",
          on_disk: true,
        },
        hnsw_config: {
          m: 64,
          ef_construct: 512,
          on_disk: true,
        },
      })
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(6)
    })

    test("should provide detailed error context for different failure scenarios", async () => {
      const differentVectorSize = 768
      mockGetCollection.mockResolvedValue({
        config: {
          params: {
            vectors: {
              size: differentVectorSize,
            },
          },
        },
      } as any)

      const deleteError = new Error("Qdrant server unavailable")
      mockDeleteCollection.mockRejectedValue(deleteError)

      let caughtError: any
      try {
        await vectorStore.initialize()
      } catch (error: any) {
        caughtError = error
      }

      expect(caughtError).toBeDefined()
      expect(caughtError.message).toContain("Vector dimension mismatch")
      expect(caughtError.message).toContain("Failed to delete existing collection with vector size")
      expect(caughtError.message).toContain("Qdrant server unavailable")
      expect(caughtError.cause).toBe(deleteError)
    })
  })

  test("should return true when collection exists", async () => {
    mockGetCollection.mockResolvedValue({
      config: {
        /* collection data */
      },
    } as any)

    const result = await vectorStore.collectionExists()

    expect(result).toBe(true)
    expect(mockGetCollection).toHaveBeenCalledTimes(1)
    expect(mockGetCollection).toHaveBeenCalledWith(expectedCollectionName)
  })

  test("should return false when collection does not exist (404 error)", async () => {
    mockGetCollection.mockRejectedValue({
      response: { status: 404 },
      message: "Not found",
    })

    const result = await vectorStore.collectionExists()

    expect(result).toBe(false)
    expect(mockGetCollection).toHaveBeenCalledTimes(1)
    expect(mockGetCollection).toHaveBeenCalledWith(expectedCollectionName)
  })

  test("should return false and log warning for non-404 errors", async () => {
    const genericError = new Error("Network error")
    mockGetCollection.mockRejectedValue(genericError)

    const result = await vectorStore.collectionExists()

    expect(result).toBe(false)
    expect(mockGetCollection).toHaveBeenCalledTimes(1)
  })

  describe("deleteCollection", () => {
    test("should delete collection when it exists", async () => {
      // Mock getCollection to simulate existing collection (collectionExists returns true)
      mockGetCollection.mockResolvedValue({ config: {} } as any)
      mockDeleteCollection.mockResolvedValue(true as any)

      await vectorStore.deleteCollection()

      expect(mockGetCollection).toHaveBeenCalledTimes(1)
      expect(mockDeleteCollection).toHaveBeenCalledTimes(1)
      expect(mockDeleteCollection).toHaveBeenCalledWith(expectedCollectionName)
    })

    test("should not attempt to delete collection when it does not exist", async () => {
      // Mock getCollection to throw (collectionExists returns false)
      mockGetCollection.mockRejectedValue(new Error("Not found"))

      await vectorStore.deleteCollection()

      expect(mockGetCollection).toHaveBeenCalledTimes(1)
      expect(mockDeleteCollection).not.toHaveBeenCalled()
    })

    test("should log and re-throw error when deletion fails", async () => {
      mockGetCollection.mockResolvedValue({ config: {} } as any)
      const deleteError = new Error("Deletion failed")
      mockDeleteCollection.mockRejectedValue(deleteError)

      await expect(vectorStore.deleteCollection()).rejects.toThrow(deleteError)

      expect(mockGetCollection).toHaveBeenCalledTimes(1)
      expect(mockDeleteCollection).toHaveBeenCalledTimes(1)
    })
  })

  describe("upsertPoints", () => {
    test("should correctly call qdrantClient.upsert with processed points", async () => {
      const mockPoints = [
        {
          id: "test-id-1",
          vector: [0.1, 0.2, 0.3],
          payload: {
            filePath: "src/components/Button.tsx",
            content: "export const Button = () => {}",
            startLine: 1,
            endLine: 3,
          },
        },
        {
          id: "test-id-2",
          vector: [0.4, 0.5, 0.6],
          payload: {
            filePath: "src/utils/helpers.ts",
            content: "export function helper() {}",
            startLine: 5,
            endLine: 7,
          },
        },
      ]

      mockUpsert.mockResolvedValue({} as any)

      await vectorStore.upsertPoints(mockPoints)

      expect(mockUpsert).toHaveBeenCalledTimes(1)
      expect(mockUpsert).toHaveBeenCalledWith(expectedCollectionName, {
        points: [
          {
            id: "test-id-1",
            vector: [0.1, 0.2, 0.3],
            payload: {
              filePath: "src/components/Button.tsx",
              content: "export const Button = () => {}",
              startLine: 1,
              endLine: 3,
              pathSegments: {
                "0": "src",
                "1": "components",
                "2": "Button.tsx",
              },
            },
          },
          {
            id: "test-id-2",
            vector: [0.4, 0.5, 0.6],
            payload: {
              filePath: "src/utils/helpers.ts",
              content: "export function helper() {}",
              startLine: 5,
              endLine: 7,
              pathSegments: {
                "0": "src",
                "1": "utils",
                "2": "helpers.ts",
              },
            },
          },
        ],
        wait: true,
      })
    })

    test("should handle points without filePath in payload", async () => {
      const mockPoints = [
        {
          id: "test-id-1",
          vector: [0.1, 0.2, 0.3],
          payload: {
            content: "some content without filePath",
            startLine: 1,
            endLine: 3,
          },
        },
      ]

      mockUpsert.mockResolvedValue({} as any)

      await vectorStore.upsertPoints(mockPoints)

      expect(mockUpsert).toHaveBeenCalledWith(expectedCollectionName, {
        points: [
          {
            id: "test-id-1",
            vector: [0.1, 0.2, 0.3],
            payload: {
              content: "some content without filePath",
              startLine: 1,
              endLine: 3,
            },
          },
        ],
        wait: true,
      })
    })

    test("should handle empty input arrays", async () => {
      mockUpsert.mockResolvedValue({} as any)

      await vectorStore.upsertPoints([])

      expect(mockUpsert).toHaveBeenCalledWith(expectedCollectionName, {
        points: [],
        wait: true,
      })
    })

    test("should correctly process pathSegments for nested file paths", async () => {
      const mockPoints = [
        {
          id: "test-id-1",
          vector: [0.1, 0.2, 0.3],
          payload: {
            filePath: "src/components/ui/forms/InputField.tsx",
            content: "export const InputField = () => {}",
            startLine: 1,
            endLine: 3,
          },
        },
      ]

      mockUpsert.mockResolvedValue({} as any)

      await vectorStore.upsertPoints(mockPoints)

      expect(mockUpsert).toHaveBeenCalledWith(expectedCollectionName, {
        points: [
          {
            id: "test-id-1",
            vector: [0.1, 0.2, 0.3],
            payload: {
              filePath: "src/components/ui/forms/InputField.tsx",
              content: "export const InputField = () => {}",
              startLine: 1,
              endLine: 3,
              pathSegments: {
                "0": "src",
                "1": "components",
                "2": "ui",
                "3": "forms",
                "4": "InputField.tsx",
              },
            },
          },
        ],
        wait: true,
      })
    })

    test("should handle error scenarios when qdrantClient.upsert fails", async () => {
      const mockPoints = [
        {
          id: "test-id-1",
          vector: [0.1, 0.2, 0.3],
          payload: {
            filePath: "src/test.ts",
            content: "test content",
            startLine: 1,
            endLine: 1,
          },
        },
      ]

      const upsertError = new Error("Upsert failed")
      mockUpsert.mockRejectedValue(upsertError)

      await expect(vectorStore.upsertPoints(mockPoints)).rejects.toThrow(upsertError)

      expect(mockUpsert).toHaveBeenCalledTimes(1)
    })
  })

  describe("search", () => {
    test("should correctly call qdrantClient.query and transform results", async () => {
      const queryVector = [0.1, 0.2, 0.3]
      const mockQdrantResults = {
        points: [
          {
            id: "test-id-1",
            score: 0.85,
            payload: {
              filePath: "src/test.ts",
              codeChunk: "test code",
              startLine: 1,
              endLine: 5,
              pathSegments: { "0": "src", "1": "test.ts" },
            },
          },
          {
            id: "test-id-2",
            score: 0.75,
            payload: {
              filePath: "src/utils.ts",
              codeChunk: "utility code",
              startLine: 10,
              endLine: 15,
              pathSegments: { "0": "src", "1": "utils.ts" },
            },
          },
        ],
      }

      mockQuery.mockResolvedValue(mockQdrantResults)

      const results = await vectorStore.search(queryVector)

      expect(mockQuery).toHaveBeenCalledTimes(1)
      const callArgs = mockQuery.mock.calls[0][1]
      expect(callArgs).toMatchObject({
        query: queryVector,
        score_threshold: DEFAULT_SEARCH_MIN_SCORE,
        limit: DEFAULT_MAX_SEARCH_RESULTS,
        params: {
          hnsw_ef: 128,
          exact: false,
        },
        with_payload: {
          include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
        },
      })
      expect(callArgs.filter).toEqual({
        must_not: [{ key: "type", match: { value: "metadata" } }],
      })

      expect(results).toEqual(mockQdrantResults.points)
    })

    test("should apply filePathPrefix filter correctly", async () => {
      const queryVector = [0.1, 0.2, 0.3]
      const directoryPrefix = "src/components"
      const mockQdrantResults = {
        points: [
          {
            id: "test-id-1",
            score: 0.85,
            payload: {
              filePath: "src/components/Button.tsx",
              codeChunk: "button code",
              startLine: 1,
              endLine: 5,
              pathSegments: { "0": "src", "1": "components", "2": "Button.tsx" },
            },
          },
        ],
      }

      mockQuery.mockResolvedValue(mockQdrantResults)

      const results = await vectorStore.search(queryVector, directoryPrefix)

      const callArgs2 = mockQuery.mock.calls[0][1]
      expect(callArgs2).toMatchObject({
        query: queryVector,
        score_threshold: DEFAULT_SEARCH_MIN_SCORE,
        limit: DEFAULT_MAX_SEARCH_RESULTS,
        params: { hnsw_ef: 128, exact: false },
        with_payload: { include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"] },
      })
      expect(callArgs2.filter).toEqual({
        must: [
          { key: "pathSegments.0", match: { value: "src" } },
          { key: "pathSegments.1", match: { value: "components" } },
        ],
        must_not: [{ key: "type", match: { value: "metadata" } }],
      })

      expect(results).toEqual(mockQdrantResults.points)
    })

    test("should use custom minScore when provided", async () => {
      const queryVector = [0.1, 0.2, 0.3]
      const customMinScore = 0.8
      const mockQdrantResults = { points: [] }

      mockQuery.mockResolvedValue(mockQdrantResults)

      await vectorStore.search(queryVector, undefined, customMinScore)

      const callArgs3 = mockQuery.mock.calls[0][1]
      expect(callArgs3).toMatchObject({
        query: queryVector,
        score_threshold: customMinScore,
        limit: DEFAULT_MAX_SEARCH_RESULTS,
        params: {
          hnsw_ef: 128,
          exact: false,
        },
        with_payload: {
          include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
        },
      })
      expect(callArgs3.filter).toEqual({
        must_not: [{ key: "type", match: { value: "metadata" } }],
      })
    })

    test("should use custom maxResults when provided", async () => {
      const queryVector = [0.1, 0.2, 0.3]
      const customMaxResults = 100
      const mockQdrantResults = { points: [] }

      mockQuery.mockResolvedValue(mockQdrantResults)

      await vectorStore.search(queryVector, undefined, undefined, customMaxResults)

      const callArgs4 = mockQuery.mock.calls[0][1]
      expect(callArgs4).toMatchObject({
        query: queryVector,
        score_threshold: DEFAULT_SEARCH_MIN_SCORE,
        limit: customMaxResults,
        params: {
          hnsw_ef: 128,
          exact: false,
        },
        with_payload: {
          include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
        },
      })
      expect(callArgs4.filter).toEqual({
        must_not: [{ key: "type", match: { value: "metadata" } }],
      })
    })

    test("should filter out results with invalid payloads", async () => {
      const queryVector = [0.1, 0.2, 0.3]
      const mockQdrantResults = {
        points: [
          {
            id: "valid-result",
            score: 0.85,
            payload: {
              filePath: "src/test.ts",
              codeChunk: "test code",
              startLine: 1,
              endLine: 5,
            },
          },
          {
            id: "invalid-result-1",
            score: 0.75,
            payload: {
              filePath: "src/invalid.ts",
            },
          },
          {
            id: "valid-result-2",
            score: 0.55,
            payload: {
              filePath: "src/test2.ts",
              codeChunk: "test code 2",
              startLine: 10,
              endLine: 15,
            },
          },
        ],
      }

      mockQuery.mockResolvedValue(mockQdrantResults)

      const results = await vectorStore.search(queryVector)

      expect(results).toHaveLength(2)
      expect(results[0].id).toBe("valid-result")
      expect(results[1].id).toBe("valid-result-2")
    })

    test("should filter out results with null or undefined payloads", async () => {
      const queryVector = [0.1, 0.2, 0.3]
      const mockQdrantResults = {
        points: [
          {
            id: "valid-result",
            score: 0.85,
            payload: {
              filePath: "src/test.ts",
              codeChunk: "test code",
              startLine: 1,
              endLine: 5,
            },
          },
          {
            id: "null-payload-result",
            score: 0.75,
            payload: null,
          },
          {
            id: "undefined-payload-result",
            score: 0.65,
            payload: undefined,
          },
          {
            id: "valid-result-2",
            score: 0.55,
            payload: {
              filePath: "src/test2.ts",
              codeChunk: "test code 2",
              startLine: 10,
              endLine: 15,
            },
          },
        ],
      }

      mockQuery.mockResolvedValue(mockQdrantResults)

      const results = await vectorStore.search(queryVector)

      expect(results).toHaveLength(2)
      expect(results[0].id).toBe("valid-result")
      expect(results[1].id).toBe("valid-result-2")
    })

    test("should handle scenarios where no results are found", async () => {
      const queryVector = [0.1, 0.2, 0.3]
      const mockQdrantResults = { points: [] }

      mockQuery.mockResolvedValue(mockQdrantResults)

      const results = await vectorStore.search(queryVector)

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(results).toEqual([])
    })

    test("should handle complex directory prefix with multiple segments", async () => {
      const queryVector = [0.1, 0.2, 0.3]
      const directoryPrefix = "src/components/ui/forms"
      const mockQdrantResults = { points: [] }

      mockQuery.mockResolvedValue(mockQdrantResults)

      await vectorStore.search(queryVector, directoryPrefix)

      const callArgs5 = mockQuery.mock.calls[0][1]
      expect(callArgs5).toMatchObject({
        query: queryVector,
        score_threshold: DEFAULT_SEARCH_MIN_SCORE,
        limit: DEFAULT_MAX_SEARCH_RESULTS,
        params: {
          hnsw_ef: 128,
          exact: false,
        },
        with_payload: {
          include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
        },
      })
      expect(callArgs5.filter).toEqual({
        must: [
          { key: "pathSegments.0", match: { value: "src" } },
          { key: "pathSegments.1", match: { value: "components" } },
          { key: "pathSegments.2", match: { value: "ui" } },
          { key: "pathSegments.3", match: { value: "forms" } },
        ],
        must_not: [{ key: "type", match: { value: "metadata" } }],
      })
    })

    test("should handle error scenarios when qdrantClient.query fails", async () => {
      const queryVector = [0.1, 0.2, 0.3]
      const queryError = new Error("Query failed")
      mockQuery.mockRejectedValue(queryError)

      await expect(vectorStore.search(queryVector)).rejects.toThrow(queryError)

      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    test("should use constants DEFAULT_MAX_SEARCH_RESULTS and DEFAULT_SEARCH_MIN_SCORE correctly", async () => {
      const queryVector = [0.1, 0.2, 0.3]
      const mockQdrantResults = { points: [] }

      mockQuery.mockResolvedValue(mockQdrantResults)

      await vectorStore.search(queryVector)

      const callArgs = mockQuery.mock.calls[0][1]
      expect(callArgs.limit).toBe(DEFAULT_MAX_SEARCH_RESULTS)
      expect(callArgs.score_threshold).toBe(DEFAULT_SEARCH_MIN_SCORE)
    })

    describe("current directory path handling", () => {
      test("should not apply filter when directoryPrefix is '.'", async () => {
        const queryVector = [0.1, 0.2, 0.3]
        const directoryPrefix = "."
        const mockQdrantResults = {
          points: [
            {
              id: "test-id-1",
              score: 0.85,
              payload: {
                filePath: "src/test.ts",
                codeChunk: "test code",
                startLine: 1,
                endLine: 5,
                pathSegments: { "0": "src", "1": "test.ts" },
              },
            },
          ],
        }

        mockQuery.mockResolvedValue(mockQdrantResults)

        const results = await vectorStore.search(queryVector, directoryPrefix)

        const callArgs7 = mockQuery.mock.calls[0][1]
        expect(callArgs7).toMatchObject({
          query: queryVector,
          score_threshold: DEFAULT_SEARCH_MIN_SCORE,
          limit: DEFAULT_MAX_SEARCH_RESULTS,
          params: {
            hnsw_ef: 128,
            exact: false,
          },
          with_payload: {
            include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
          },
        })
        expect(callArgs7.filter).toEqual({
          must_not: [{ key: "type", match: { value: "metadata" } }],
        })

        expect(results).toEqual(mockQdrantResults.points)
      })

      test("should not apply filter when directoryPrefix is './'", async () => {
        const queryVector = [0.1, 0.2, 0.3]
        const directoryPrefix = "./"
        const mockQdrantResults = { points: [] }

        mockQuery.mockResolvedValue(mockQdrantResults)

        await vectorStore.search(queryVector, directoryPrefix)

        const callArgs6 = mockQuery.mock.calls[0][1]
        expect(callArgs6).toMatchObject({
          query: queryVector,
          score_threshold: DEFAULT_SEARCH_MIN_SCORE,
          limit: DEFAULT_MAX_SEARCH_RESULTS,
          params: {
            hnsw_ef: 128,
            exact: false,
          },
          with_payload: {
            include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
          },
        })
        expect(callArgs6.filter).toEqual({
          must_not: [{ key: "type", match: { value: "metadata" } }],
        })
      })

      test("should not apply filter when directoryPrefix is empty string", async () => {
        const queryVector = [0.1, 0.2, 0.3]
        const directoryPrefix = ""
        const mockQdrantResults = { points: [] }

        mockQuery.mockResolvedValue(mockQdrantResults)

        await vectorStore.search(queryVector, directoryPrefix)

        const callArgs8 = mockQuery.mock.calls[0][1]
        expect(callArgs8).toMatchObject({
          query: queryVector,
          score_threshold: DEFAULT_SEARCH_MIN_SCORE,
          limit: DEFAULT_MAX_SEARCH_RESULTS,
          params: {
            hnsw_ef: 128,
            exact: false,
          },
          with_payload: {
            include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
          },
        })
        expect(callArgs8.filter).toEqual({
          must_not: [{ key: "type", match: { value: "metadata" } }],
        })
      })

      test("should not apply filter when directoryPrefix is '.\\' (Windows style)", async () => {
        const queryVector = [0.1, 0.2, 0.3]
        const directoryPrefix = ".\\"
        const mockQdrantResults = { points: [] }

        mockQuery.mockResolvedValue(mockQdrantResults)

        await vectorStore.search(queryVector, directoryPrefix)

        const callArgs9 = mockQuery.mock.calls[0][1]
        expect(callArgs9).toMatchObject({
          query: queryVector,
          score_threshold: DEFAULT_SEARCH_MIN_SCORE,
          limit: DEFAULT_MAX_SEARCH_RESULTS,
          params: {
            hnsw_ef: 128,
            exact: false,
          },
          with_payload: {
            include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
          },
        })
        expect(callArgs9.filter).toEqual({
          must_not: [{ key: "type", match: { value: "metadata" } }],
        })
      })

      test("should not apply filter when directoryPrefix has trailing slashes", async () => {
        const queryVector = [0.1, 0.2, 0.3]
        const directoryPrefix = ".///"
        const mockQdrantResults = { points: [] }

        mockQuery.mockResolvedValue(mockQdrantResults)

        await vectorStore.search(queryVector, directoryPrefix)

        const callArgs10 = mockQuery.mock.calls[0][1]
        expect(callArgs10).toMatchObject({
          query: queryVector,
          score_threshold: DEFAULT_SEARCH_MIN_SCORE,
          limit: DEFAULT_MAX_SEARCH_RESULTS,
          params: {
            hnsw_ef: 128,
            exact: false,
          },
          with_payload: {
            include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
          },
        })
        expect(callArgs10.filter).toEqual({
          must_not: [{ key: "type", match: { value: "metadata" } }],
        })
      })

      test("should still apply filter for relative paths like './src'", async () => {
        const queryVector = [0.1, 0.2, 0.3]
        const directoryPrefix = "./src"
        const mockQdrantResults = { points: [] }

        mockQuery.mockResolvedValue(mockQdrantResults)

        await vectorStore.search(queryVector, directoryPrefix)

        const callArgs11 = mockQuery.mock.calls[0][1]
        expect(callArgs11).toMatchObject({
          query: queryVector,
          score_threshold: DEFAULT_SEARCH_MIN_SCORE,
          limit: DEFAULT_MAX_SEARCH_RESULTS,
          params: {
            hnsw_ef: 128,
            exact: false,
          },
          with_payload: {
            include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
          },
        })
        expect(callArgs11.filter).toEqual({
          must: [
            {
              key: "pathSegments.0",
              match: { value: "src" },
            },
          ],
          must_not: [{ key: "type", match: { value: "metadata" } }],
        })
      })

      test("should still apply filter for regular directory paths", async () => {
        const queryVector = [0.1, 0.2, 0.3]
        const directoryPrefix = "src"
        const mockQdrantResults = { points: [] }

        mockQuery.mockResolvedValue(mockQdrantResults)

        await vectorStore.search(queryVector, directoryPrefix)

        const callArgs12 = mockQuery.mock.calls[0][1]
        expect(callArgs12).toMatchObject({
          query: queryVector,
          score_threshold: DEFAULT_SEARCH_MIN_SCORE,
          limit: DEFAULT_MAX_SEARCH_RESULTS,
          params: {
            hnsw_ef: 128,
            exact: false,
          },
          with_payload: {
            include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
          },
        })
        expect(callArgs12.filter).toEqual({
          must: [
            {
              key: "pathSegments.0",
              match: { value: "src" },
            },
          ],
          must_not: [{ key: "type", match: { value: "metadata" } }],
        })
      })
    })
  })
})
