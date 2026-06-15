/**
 * Comprehensive tests for LanceDBVectorStore.
 * All LanceDB and fs operations are mocked.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import type { Payload } from "../../../../src/indexing/interfaces"
import * as path from "path"
import fs from "fs"

const mockTable = {
  delete: mock().mockResolvedValue(undefined),
  add: mock().mockResolvedValue(undefined),
  query: mock().mockReturnThis(),
  where: mock().mockReturnThis(),
  toArray: mock().mockResolvedValue([]),
  countRows: mock().mockResolvedValue(0),
  vectorSearch: mock().mockReturnThis(),
  limit: mock().mockReturnThis(),
  refineFactor: mock().mockReturnThis(),
  postfilter: mock().mockReturnThis(),
  openTable: mock().mockResolvedValue(undefined),
  search: mock().mockReturnThis(),
  name: "vector",
  isOpen: true,
  close: mock(),
  display: mock(),
  schema: {},
  count: mock(),
  get: mock(),
  create: mock(),
  drop: mock(),
  insert: mock(),
  update: mock(),
  find: mock(),
  remove: mock(),
  createIndex: mock(),
  dropIndex: mock(),
  indexes: [],
  columns: [],
  primaryKey: "id",
  metadata: {},
  batch: mock(),
  distanceRange: mock().mockReturnThis(),
}
const mockDb = {
  openTable: mock().mockResolvedValue(mockTable),
  createTable: mock().mockResolvedValue(mockTable),
  dropTable: mock().mockResolvedValue(undefined),
  tableNames: mock().mockResolvedValue(["vector", "metadata"]),
  close: mock().mockResolvedValue(undefined),
  isOpen: true,
  display: mock(),
  createEmptyTable: mock(),
  dropAllTables: mock(),
}

const mockLanceDBModule = {
  connect: mock().mockResolvedValue(mockDb),
}

const mockLoadLanceDB = mock().mockResolvedValue(mockLanceDBModule)

mock.module("@lancedb/lancedb", () => mockLanceDBModule)
mock.module("../../../../src/indexing/vector-store/lancedb-loader", () => ({
  loadLanceDB: mockLoadLanceDB,
}))

// Import module under test AFTER mock.module
import { LanceDBVectorStore } from "../../../../src/indexing/vector-store/lancedb-vector-store"

const workspacePath = path.join("mock", "workspace")
const vectorSize = 768
const dbDirectory = path.join("mock", "db")
let store: LanceDBVectorStore

// Collect all mock functions for bulk reset
const allMocks = [
  mockTable.delete,
  mockTable.add,
  mockTable.query,
  mockTable.where,
  mockTable.toArray,
  mockTable.countRows,
  mockTable.vectorSearch,
  mockTable.limit,
  mockTable.refineFactor,
  mockTable.postfilter,
  mockTable.openTable,
  mockTable.search,
  mockTable.close,
  mockTable.display,
  mockTable.count,
  mockTable.get,
  mockTable.create,
  mockTable.drop,
  mockTable.insert,
  mockTable.update,
  mockTable.find,
  mockTable.remove,
  mockTable.createIndex,
  mockTable.dropIndex,
  mockTable.batch,
  mockTable.distanceRange,
  mockDb.openTable,
  mockDb.createTable,
  mockDb.dropTable,
  mockDb.tableNames,
  mockDb.close,
  mockDb.display,
  mockDb.createEmptyTable,
  mockDb.dropAllTables,
  mockLanceDBModule.connect,
  mockLoadLanceDB,
]

function resetAllMocks() {
  for (const m of allMocks) {
    m.mockReset()
  }
  // Re-apply default resolved values after reset
  mockTable.delete.mockResolvedValue(undefined)
  mockTable.add.mockResolvedValue(undefined)
  mockTable.query.mockReturnThis()
  mockTable.where.mockReturnThis()
  mockTable.toArray.mockResolvedValue([])
  mockTable.countRows.mockResolvedValue(0)
  mockTable.vectorSearch.mockReturnThis()
  mockTable.limit.mockReturnThis()
  mockTable.refineFactor.mockReturnThis()
  mockTable.postfilter.mockReturnThis()
  mockTable.openTable.mockResolvedValue(undefined)
  mockTable.search.mockReturnThis()
  mockTable.distanceRange.mockReturnThis()
  mockDb.openTable.mockResolvedValue(mockTable)
  mockDb.createTable.mockResolvedValue(mockTable)
  mockDb.dropTable.mockResolvedValue(undefined)
  mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
  mockDb.close.mockResolvedValue(undefined)
  mockLanceDBModule.connect.mockResolvedValue(mockDb)
  mockLoadLanceDB.mockResolvedValue(mockLanceDBModule)
}

describe("LocalVectorStore", () => {
  beforeEach(() => {
    resetAllMocks()
    store = new LanceDBVectorStore(workspacePath, vectorSize, dbDirectory)
    // Patch LanceDB module directly for loadLanceDBModule
    // @ts-ignore
    store.lancedbModule = mockLanceDBModule
    // Patch db/table for getDb/getTable
    // @ts-ignore
    store.db = mockDb
    // @ts-ignore
    store.table = mockTable
  })

  afterEach(async () => {
    await store["closeConnect"]()
  })

  describe("constructor", () => {
    test("should set dbPath and vectorSize correctly", () => {
      expect(store["vectorSize"]).toBe(vectorSize)
      expect(store["workspacePath"]).toBe(workspacePath)
      expect(store["dbPath"]).toContain("mock")
    })

    test("loads LanceDB through the shared loader", async () => {
      // @ts-ignore
      store.lancedbModule = null
      await store["loadLanceDBModule"]()
      expect(mockLoadLanceDB).toHaveBeenCalledTimes(1)
      expect(mockLanceDBModule.connect).not.toHaveBeenCalled()
    })
  })

  describe("initialize", () => {
    test("should create tables if not exist", async () => {
      mockDb.tableNames.mockResolvedValue([])
      mockDb.createTable.mockResolvedValue(mockTable)
      const result = await store.initialize()
      expect(result).toBe(true)
      expect(mockDb.createTable).toHaveBeenCalled()
    })

    test("should recreate tables if vector size changed", async () => {
      mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
      mockDb.openTable.mockResolvedValue(mockTable)
      store["_getStoredVectorSize"] = mock().mockResolvedValue(vectorSize + 1)
      mockDb.dropTable.mockResolvedValue(undefined)
      mockDb.createTable.mockResolvedValue(mockTable)
      const result = await store.initialize()
      expect(result).toBe(true)
      expect(mockDb.dropTable).toHaveBeenCalled()
    })

    test("should not recreate if vector size matches", async () => {
      mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
      mockDb.openTable.mockResolvedValue(mockTable)
      store["_getStoredVectorSize"] = mock().mockResolvedValue(vectorSize)
      const result = await store.initialize()
      expect(result).toBe(false)
    })

    test("should throw error on LanceDB failure", async () => {
      mockDb.tableNames.mockRejectedValue(new Error("fail"))
      await expect(store.initialize()).rejects.toThrow()
    })

    test("should recreate tables when stored embedding identity differs", async () => {
      const identity = {
        provider: "openai",
        modelId: "text-embedding-3-small",
        dimension: vectorSize,
      }
      store = new (LanceDBVectorStore as any)(workspacePath, vectorSize, dbDirectory, identity)
      // @ts-ignore
      store.lancedbModule = mockLanceDBModule
      // @ts-ignore
      store.db = mockDb
      // @ts-ignore
      store.table = mockTable

      const metadataTable = {
        query: mock().mockReturnThis(),
        where: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([]),
      }

      metadataTable.where.mockImplementation((query: string) => {
        const rows = {
          "key = 'vector_size'": [{ key: "vector_size", value: vectorSize }],
          "key = 'embedding_provider'": [{ key: "embedding_provider", value: "ollama" }],
          "key = 'embedding_model_id'": [{ key: "embedding_model_id", value: "nomic-embed-text" }],
          "key = 'embedding_dimension'": [{ key: "embedding_dimension", value: vectorSize }],
        }
        metadataTable.toArray.mockResolvedValue(rows[query as keyof typeof rows] ?? [])
        return metadataTable
      })

      mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
      mockTable.countRows.mockResolvedValue(4)
      mockDb.openTable.mockImplementation((name: string) => {
        if (name === "metadata") return Promise.resolve(metadataTable as any)
        return Promise.resolve(mockTable as any)
      })

      const result = await store.initialize()

      expect(result).toBe(true)
      expect(mockDb.dropTable).toHaveBeenCalledWith("vector")
      expect(mockDb.dropTable).toHaveBeenCalledWith("metadata")
    })

    test("should recreate legacy populated tables when identity metadata is missing", async () => {
      const identity = {
        provider: "openai",
        modelId: "text-embedding-3-small",
        dimension: vectorSize,
      }
      store = new (LanceDBVectorStore as any)(workspacePath, vectorSize, dbDirectory, identity)
      // @ts-ignore
      store.lancedbModule = mockLanceDBModule
      // @ts-ignore
      store.db = mockDb
      // @ts-ignore
      store.table = mockTable

      const metadataTable = {
        query: mock().mockReturnThis(),
        where: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([]),
      }

      metadataTable.where.mockImplementation((query: string) => {
        const rows = {
          "key = 'vector_size'": [{ key: "vector_size", value: vectorSize }],
          "key = 'embedding_provider'": [],
          "key = 'embedding_model_id'": [],
          "key = 'embedding_dimension'": [],
        }
        metadataTable.toArray.mockResolvedValue(rows[query as keyof typeof rows] ?? [])
        return metadataTable
      })

      mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
      mockTable.countRows.mockResolvedValue(2)
      mockDb.openTable.mockImplementation((name: string) => {
        if (name === "metadata") return Promise.resolve(metadataTable as any)
        return Promise.resolve(mockTable as any)
      })

      const result = await store.initialize()

      expect(result).toBe(true)
      expect(mockDb.dropTable).toHaveBeenCalledWith("vector")
      expect(mockDb.dropTable).toHaveBeenCalledWith("metadata")
    })
  })

  describe("upsertPoints", () => {
    test("should do nothing for empty points", async () => {
      await expect(store.upsertPoints([])).resolves.toBeUndefined()
    })

    test("should do nothing for invalid payloads", async () => {
      const points = [{ id: "1", vector: [1, 2, 3], payload: {} }]
      mockTable.add.mockResolvedValue(undefined)
      await expect(store.upsertPoints(points)).resolves.toBeUndefined()
      expect(mockTable.add).not.toHaveBeenCalled()
    })

    test("should upsert valid points", async () => {
      const points = [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          vector: [1, 2, 3],
          payload: { filePath: "a", codeChunk: "b", startLine: 1, endLine: 2 },
        },
      ]
      mockTable.delete.mockResolvedValue(undefined)
      mockTable.add.mockResolvedValue(undefined)
      await store.upsertPoints(points)
      expect(mockTable.delete).toHaveBeenCalled()
      expect(mockTable.add).toHaveBeenCalled()
    })

    test("should throw error on add failure", async () => {
      const points = [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          vector: [1, 2, 3],
          payload: { filePath: "a", codeChunk: "b", startLine: 1, endLine: 2 },
        },
      ]
      mockTable.delete.mockResolvedValue(undefined)
      mockTable.add.mockRejectedValue(new Error("fail"))
      await expect(store.upsertPoints(points)).rejects.toThrow()
    })
  })

  describe("search", () => {
    test("should return filtered results using distanceRange", async () => {
      const distanceRangeSpy = mock().mockReturnThis()
      mockTable.search.mockResolvedValue({
        where: mock().mockReturnThis(),
        distanceType: mock().mockReturnThis(),
        distanceRange: distanceRangeSpy,
        limit: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([
          { id: "2", _distance: 0.2, filePath: "a", codeChunk: "c", startLine: 3, endLine: 4 },
        ]),
      })
      const results = await store.search([1, 2, 3], "a", 0.7, 1)
      expect(results.length).toBe(1)
      const first = results[0]
      expect(first).toBeDefined()
      expect(first!.id).toBe("2")
      expect(first!.score).toBeCloseTo(1 - 0.2)
      // Verify distanceRange was called with correct parameters (0 to 1 - minScore)
      const calls = distanceRangeSpy.mock.calls[0]
      expect(calls).toBeDefined()
      expect(calls![0]).toBe(0)
      expect(calls![1]).toBeCloseTo(0.3) // Handle floating point precision: 1 - 0.7
    })

    test("should filter by minScore at database level", async () => {
      const distanceRangeSpy = mock().mockReturnThis()
      mockTable.search.mockResolvedValue({
        where: mock().mockReturnThis(),
        distanceType: mock().mockReturnThis(),
        distanceRange: distanceRangeSpy,
        limit: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([
          { id: "2", _distance: 0.2, filePath: "a", codeChunk: "c", startLine: 3, endLine: 4 },
        ]),
      })
      const results = await store.search([1, 2, 3], "a", 0.1, 2)
      expect(results.length).toBe(1)
      const first = results[0]
      expect(first).toBeDefined()
      expect(first!.id).toBe("2")
      // Verify distanceRange was called with 0 to 0.9 (1 - 0.1)
      expect(distanceRangeSpy).toHaveBeenCalledWith(0, 0.9)
    })

    test("should throw error on search failure", async () => {
      mockTable.search.mockRejectedValue(new Error("fail"))
      await expect(store.search([1, 2, 3])).rejects.toThrow()
    })
  })

  describe("deletePointsByFilePath", () => {
    test("should call deletePointsByMultipleFilePaths", async () => {
      const spy = spyOn(store, "deletePointsByMultipleFilePaths").mockResolvedValue(undefined)
      await store.deletePointsByFilePath("a")
      expect(spy).toHaveBeenCalledWith(["a"])
    })
  })

  describe("deletePointsByMultipleFilePaths", () => {
    test("should do nothing for empty filePaths", async () => {
      await expect(store.deletePointsByMultipleFilePaths([])).resolves.toBeUndefined()
    })

    test("should delete points for valid filePaths", async () => {
      mockTable.delete.mockResolvedValue(undefined)
      await store.deletePointsByMultipleFilePaths(["a", "b"])
      expect(mockTable.delete).toHaveBeenCalled()
    })

    test("should throw error on delete failure", async () => {
      mockTable.delete.mockRejectedValue(new Error("fail"))
      await expect(store.deletePointsByMultipleFilePaths(["a"])).rejects.toThrow()
    })
  })

  describe("deleteCollection", () => {
    test("should remove dbPath if exists", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true as any)
      spyOn(fs, "rmSync").mockImplementation(() => {})
      await expect(store.deleteCollection()).resolves.toBeUndefined()
      expect(fs.rmSync).toHaveBeenCalled()
    })

    test("should clear tables if rmSync fails", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true as any)
      spyOn(fs, "rmSync").mockImplementation(() => {
        throw new Error("fail")
      })
      mockDb.tableNames.mockImplementation(() => ["vector"])
      mockDb.dropTable.mockResolvedValue(undefined)
      await expect(store.deleteCollection()).rejects.toThrow()
      expect(mockDb.dropTable).toHaveBeenCalled()
    })
  })

  describe("clearCollection", () => {
    test("should delete all records from table and metadata", async () => {
      mockTable.delete.mockResolvedValue(undefined)
      mockDb.tableNames.mockResolvedValue(["metadata"])
      mockDb.openTable.mockResolvedValue(mockTable)
      mockTable.delete.mockResolvedValue(undefined)
      await expect(store.clearCollection()).resolves.toBeUndefined()
      expect(mockTable.delete).toHaveBeenCalledWith("true")
    })

    test("should warn if metadata table clear fails", async () => {
      mockTable.delete.mockResolvedValue(undefined)
      mockDb.tableNames.mockResolvedValue(["metadata"])
      mockDb.openTable.mockRejectedValue(new Error("fail"))
      await expect(store.clearCollection()).resolves.toBeUndefined()
    })

    test("should throw error on main table clear failure", async () => {
      mockTable.delete.mockRejectedValue(new Error("fail"))
      await expect(store.clearCollection()).rejects.toThrow()
    })
  })

  describe("collectionExists", () => {
    test("should return true if vector table exists", async () => {
      mockDb.tableNames.mockResolvedValue(["vector"])
      const exists = await store.collectionExists()
      expect(exists).toBe(true)
    })

    test("should return false if vector table does not exist", async () => {
      mockDb.tableNames.mockResolvedValue([])
      const exists = await store.collectionExists()
      expect(exists).toBe(false)
    })

    test("should return false on error", async () => {
      mockDb.tableNames.mockRejectedValue(new Error("fail"))
      const exists = await store.collectionExists()
      expect(exists).toBe(false)
    })
  })

  describe("isPayloadValid", () => {
    test("should return false for null/undefined", () => {
      expect(store["isPayloadValid"](null)).toBe(false)
      expect(store["isPayloadValid"](undefined)).toBe(false)
    })

    test("should return false for missing keys", () => {
      expect(store["isPayloadValid"]({ filePath: "a" })).toBe(false)
    })

    test("should return true for valid payload", () => {
      const payload: Payload = { filePath: "a", codeChunk: "b", startLine: 1, endLine: 2 }
      expect(store["isPayloadValid"](payload)).toBe(true)
    })
  })

  describe("escapeSqlString", () => {
    test("should double single quotes", () => {
      expect(store["escapeSqlString"]("O'Reilly")).toBe("O''Reilly")
    })

    test("should handle SQL injection attempts", () => {
      expect(store["escapeSqlString"]("' OR '1'='1")).toBe("'' OR ''1''=''1")
    })

    test("should handle multiple consecutive quotes", () => {
      expect(store["escapeSqlString"]("''")).toBe("''''")
    })

    test("should handle empty strings", () => {
      expect(store["escapeSqlString"]("")).toBe("")
    })

    test("should preserve backslashes", () => {
      expect(store["escapeSqlString"]("C:\\Users\\test")).toBe("C:\\Users\\test")
    })

    test("should handle strings with no special characters", () => {
      expect(store["escapeSqlString"]("normalstring")).toBe("normalstring")
    })

    test("should handle unicode characters", () => {
      expect(store["escapeSqlString"]("test's 文件")).toBe("test''s 文件")
    })

    test("should prevent comment injection attempts", () => {
      expect(store["escapeSqlString"]("test' --")).toBe("test'' --")
    })
  })

  describe("escapeSqlLikePattern", () => {
    test("should escape percent signs", () => {
      expect(store["escapeSqlLikePattern"]("50%")).toBe("50\\%")
    })

    test("should escape underscores", () => {
      expect(store["escapeSqlLikePattern"]("test_file")).toBe("test\\_file")
    })

    test("should escape both quotes and wildcards", () => {
      expect(store["escapeSqlLikePattern"]("test'_%")).toBe("test''\\_\\%")
    })

    test("should handle empty strings", () => {
      expect(store["escapeSqlLikePattern"]("")).toBe("")
    })

    test("should handle multiple wildcards", () => {
      expect(store["escapeSqlLikePattern"]("%%__")).toBe("\\%\\%\\_\\_")
    })

    test("should escape quotes before wildcards", () => {
      const result = store["escapeSqlLikePattern"]("path's%file_name")
      expect(result).toBe("path''s\\%file\\_name")
    })

    test("should escape backslashes in Windows paths", () => {
      expect(store["escapeSqlLikePattern"]("C:\\Users\\test")).toBe("C:\\\\Users\\\\test")
    })

    test("should escape backslashes before wildcards", () => {
      expect(store["escapeSqlLikePattern"]("C:\\test_file%")).toBe("C:\\\\test\\_file\\%")
    })

    test("should handle backslash at end", () => {
      expect(store["escapeSqlLikePattern"]("path\\")).toBe("path\\\\")
    })
  })

  describe("isValidId", () => {
    test("should accept UUID ids", () => {
      const id = "123e4567-e89b-12d3-a456-426614174000"
      expect(store["isValidId"](id)).toBe(true)
    })

    test("should reject non UUID ids", () => {
      expect(store["isValidId"]("test")).toBe(false)
      expect(store["isValidId"]("test' OR id != '")).toBe(false)
      expect(store["isValidId"]("123e4567-e89b-12d3-a456")).toBe(false)
    })
  })

  describe("SQL Injection Prevention", () => {
    test("should reject non UUID ids in upsertPoints", async () => {
      const maliciousId = "test' OR id != '"
      const points = [
        {
          id: maliciousId,
          vector: [1, 2, 3],
          payload: {
            filePath: "test.ts",
            codeChunk: "code",
            startLine: 1,
            endLine: 2,
          },
        },
      ]

      mockTable.delete.mockResolvedValue(undefined)
      mockTable.add.mockResolvedValue(undefined)
      await expect(store.upsertPoints(points)).rejects.toThrow("Invalid point id format")
      expect(mockTable.delete).not.toHaveBeenCalled()
      expect(mockTable.add).not.toHaveBeenCalled()
    })

    test("should reject batches that include non UUID ids", async () => {
      const points = [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          vector: [1, 2, 3],
          payload: { filePath: "a", codeChunk: "b", startLine: 1, endLine: 2 },
        },
        {
          id: "' OR '1'='1",
          vector: [4, 5, 6],
          payload: { filePath: "c", codeChunk: "d", startLine: 3, endLine: 4 },
        },
      ]

      mockTable.delete.mockResolvedValue(undefined)
      mockTable.add.mockResolvedValue(undefined)
      await expect(store.upsertPoints(points)).rejects.toThrow("Invalid point id format")
      expect(mockTable.delete).not.toHaveBeenCalled()
      expect(mockTable.add).not.toHaveBeenCalled()
    })

    test("should prevent injection via directory prefix in search", async () => {
      const maliciousPrefix = "src' OR '1'='1"
      const whereSpy = mock().mockReturnThis()
      mockTable.search.mockResolvedValue({
        where: whereSpy,
        distanceType: mock().mockReturnThis(),
        distanceRange: mock().mockReturnThis(),
        limit: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([]),
      })

      await store.search([1, 2, 3], maliciousPrefix)

      // Verify proper escaping in the where clause
      expect(whereSpy).toHaveBeenCalledWith("`filePath` LIKE 'src'' OR ''1''=''1%'")
    })

    test("should prevent injection with wildcards in directory prefix", async () => {
      const maliciousPrefix = "50%_test"
      const whereSpy = mock().mockReturnThis()
      mockTable.search.mockResolvedValue({
        where: whereSpy,
        distanceType: mock().mockReturnThis(),
        distanceRange: mock().mockReturnThis(),
        limit: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([]),
      })

      await store.search([1, 2, 3], maliciousPrefix)

      expect(whereSpy).toHaveBeenCalledWith("`filePath` LIKE '50\\%\\_test%'")
    })

    test("should handle Windows paths with backslashes in search", async () => {
      const windowsPrefix = "C:\\Users\\test"
      const whereSpy = mock().mockReturnThis()
      mockTable.search.mockResolvedValue({
        where: whereSpy,
        distanceType: mock().mockReturnThis(),
        distanceRange: mock().mockReturnThis(),
        limit: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([]),
      })

      await store.search([1, 2, 3], windowsPrefix)

      // Backslashes should be escaped in LIKE patterns
      expect(whereSpy).toHaveBeenCalledWith("`filePath` LIKE 'C:\\\\Users\\\\test%'")
    })

    test("should prevent injection via file paths in deletePointsByFilePath", async () => {
      const maliciousPath = "file.ts' OR '1'='1"
      mockTable.delete.mockResolvedValue(undefined)

      await store.deletePointsByFilePath(maliciousPath)

      expect(mockTable.delete).toHaveBeenCalledWith("`filePath` IN ('file.ts'' OR ''1''=''1')")
    })

    test("should prevent injection via multiple file paths in deletePointsByMultipleFilePaths", async () => {
      const paths = ["normal.ts", "file' OR '1'='1.ts", "another.ts"]
      mockTable.delete.mockResolvedValue(undefined)

      await store.deletePointsByMultipleFilePaths(paths)

      expect(mockTable.delete).toHaveBeenCalledWith(
        "`filePath` IN ('normal.ts', 'file'' OR ''1''=''1.ts', 'another.ts')",
      )
    })

    test("should handle paths with backslashes safely", async () => {
      const windowsPath = "C:\\Users\\test\\file.ts"
      mockTable.delete.mockResolvedValue(undefined)

      await store.deletePointsByFilePath(windowsPath)

      // Backslashes should be preserved, only quotes escaped
      expect(mockTable.delete).toHaveBeenCalledWith(`\`filePath\` IN ('C:\\Users\\test\\file.ts')`)
    })
  })
})
