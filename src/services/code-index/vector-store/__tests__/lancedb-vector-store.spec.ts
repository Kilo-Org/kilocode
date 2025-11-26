// kilocode_change - new file

// npx vitest run services/code-index/vector-store/__tests__/local-vector-store.spec.ts

/**
 * Comprehensive tests for LocalVectorStore.
 * All LanceDB and fs operations are mocked.
 */

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest"
import { LanceDBVectorStore } from "../lancedb-vector-store"
import { LanceDBManager } from "../../../../utils/lancedb-manager"
import { Payload } from "../../interfaces"
import * as path from "path"
const fs = require("fs")
const mockTable = {
	delete: vi.fn().mockResolvedValue(undefined),
	add: vi.fn().mockResolvedValue(undefined),
	query: vi.fn().mockReturnThis(),
	where: vi.fn().mockReturnThis(),
	toArray: vi.fn().mockResolvedValue([]),
	vectorSearch: vi.fn().mockReturnThis(),
	limit: vi.fn().mockReturnThis(),
	refineFactor: vi.fn().mockReturnThis(),
	postfilter: vi.fn().mockReturnThis(),
	openTable: vi.fn().mockResolvedValue(undefined),
	search: vi.fn().mockReturnThis(),
	name: "vector",
	isOpen: true,
	close: vi.fn(),
	display: vi.fn(),
	schema: {},
	count: vi.fn(),
	get: vi.fn(),
	create: vi.fn(),
	drop: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	find: vi.fn(),
	remove: vi.fn(),
	createIndex: vi.fn(),
	dropIndex: vi.fn(),
	indexes: [],
	columns: [],
	primaryKey: "id",
	metadata: {},
	batch: vi.fn(),
	distanceRange: vi.fn().mockReturnThis(),
}
const mockDb = {
	openTable: vi.fn().mockResolvedValue(mockTable),
	createTable: vi.fn().mockResolvedValue(mockTable),
	dropTable: vi.fn().mockResolvedValue(undefined),
	tableNames: vi.fn().mockResolvedValue(["vector", "metadata"]),
	close: vi.fn().mockResolvedValue(undefined),
	isOpen: true,
	display: vi.fn(),
	createEmptyTable: vi.fn(),
	dropAllTables: vi.fn(),
}

const mockLanceDBModule = {
	connect: vi.fn().mockResolvedValue(mockDb),
}
const mockLanceDBManager = {
	ensureLanceDBAvailable: vi.fn(),
	getNodeModulesPath: vi.fn(() => "mock_node_modules"),
}

vi.mock("@lancedb/lancedb", () => mockLanceDBModule)

const workspacePath = path.join("mock", "workspace")
const vectorSize = 768
const dbDirectory = path.join("mock", "db")
let store: LanceDBVectorStore

describe("LocalVectorStore", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		store = new LanceDBVectorStore(
			workspacePath,
			vectorSize,
			dbDirectory,
			mockLanceDBManager as unknown as LanceDBManager,
		)
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
		it("should set dbPath and vectorSize correctly", () => {
			expect(store["vectorSize"]).toBe(vectorSize)
			expect(store["workspacePath"]).toBe(workspacePath)
			expect(store["dbPath"]).toContain("mock")
		})
	})

	describe("initialize", () => {
		it("should create tables if not exist", async () => {
			mockDb.tableNames.mockResolvedValue([])
			mockDb.createTable.mockResolvedValue(mockTable)
			const result = await store.initialize()
			expect(result).toBe(true)
			expect(mockDb.createTable).toHaveBeenCalled()
		})

		it("should recreate tables if vector size changed", async () => {
			mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
			mockDb.openTable.mockResolvedValue(mockTable)
			store["_getStoredVectorSize"] = vi.fn().mockResolvedValue(vectorSize + 1)
			mockDb.dropTable.mockResolvedValue(undefined)
			mockDb.createTable.mockResolvedValue(mockTable)
			const result = await store.initialize()
			expect(result).toBe(true)
			expect(mockDb.dropTable).toHaveBeenCalled()
		})

		it("should not recreate if vector size matches", async () => {
			mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
			mockDb.openTable.mockResolvedValue(mockTable)
			store["_getStoredVectorSize"] = vi.fn().mockResolvedValue(vectorSize)
			const result = await store.initialize()
			expect(result).toBe(false)
		})

		it("should throw error on LanceDB failure", async () => {
			mockDb.tableNames.mockRejectedValue(new Error("fail"))
			await expect(store.initialize()).rejects.toThrow()
		})
	})

	describe("upsertPoints", () => {
		it("should do nothing for empty points", async () => {
			await expect(store.upsertPoints([])).resolves.toBeUndefined()
		})

		it("should do nothing for invalid payloads", async () => {
			const points = [{ id: "1", vector: [1, 2, 3], payload: {} }]
			mockTable.add.mockResolvedValue(undefined)
			await expect(store.upsertPoints(points)).resolves.toBeUndefined()
			expect(mockTable.add).not.toHaveBeenCalled()
		})

		it("should upsert valid points", async () => {
			const points = [
				{
					id: "1",
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

		it("should throw error on add failure", async () => {
			const points = [
				{
					id: "1",
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
		it("should return filtered results using distanceRange", async () => {
			const distanceRangeSpy = vi.fn().mockReturnThis()
			mockTable.search.mockResolvedValue({
				where: vi.fn().mockReturnThis(),
				distanceType: vi.fn().mockReturnThis(),
				distanceRange: distanceRangeSpy,
				limit: vi.fn().mockReturnThis(),
				toArray: vi
					.fn()
					.mockResolvedValue([
						{ id: "2", _distance: 0.2, filePath: "a", codeChunk: "c", startLine: 3, endLine: 4 },
					]),
			})
			const results = await store.search([1, 2, 3], "a", 0.7, 1)
			expect(results.length).toBe(1)
			expect(results[0].id).toBe("2")
			expect(results[0].score).toBeCloseTo(1 - 0.2)
			// Verify distanceRange was called with correct parameters (0 to 1 - minScore)
			const calls = distanceRangeSpy.mock.calls[0]
			expect(calls[0]).toBe(0)
			expect(calls[1]).toBeCloseTo(0.3) // Handle floating point precision: 1 - 0.7
		})

		it("should filter by minScore at database level", async () => {
			const distanceRangeSpy = vi.fn().mockReturnThis()
			mockTable.search.mockResolvedValue({
				where: vi.fn().mockReturnThis(),
				distanceType: vi.fn().mockReturnThis(),
				distanceRange: distanceRangeSpy,
				limit: vi.fn().mockReturnThis(),
				toArray: vi
					.fn()
					.mockResolvedValue([
						{ id: "2", _distance: 0.2, filePath: "a", codeChunk: "c", startLine: 3, endLine: 4 },
					]),
			})
			const results = await store.search([1, 2, 3], "a", 0.1, 2)
			expect(results.length).toBe(1)
			expect(results[0].id).toBe("2")
			// Verify distanceRange was called with 0 to 0.9 (1 - 0.1)
			expect(distanceRangeSpy).toHaveBeenCalledWith(0, 0.9)
		})

		it("should throw error on search failure", async () => {
			mockTable.search.mockRejectedValue(new Error("fail"))
			await expect(store.search([1, 2, 3])).rejects.toThrow()
		})
	})

	describe("deletePointsByFilePath", () => {
		it("should call deletePointsByMultipleFilePaths", async () => {
			const spy = vi.spyOn(store, "deletePointsByMultipleFilePaths").mockResolvedValue(undefined)
			await store.deletePointsByFilePath("a")
			expect(spy).toHaveBeenCalledWith(["a"])
		})
	})

	describe("deletePointsByMultipleFilePaths", () => {
		it("should do nothing for empty filePaths", async () => {
			await expect(store.deletePointsByMultipleFilePaths([])).resolves.toBeUndefined()
		})

		it("should delete points for valid filePaths", async () => {
			mockTable.delete.mockResolvedValue(undefined)
			await store.deletePointsByMultipleFilePaths(["a", "b"])
			expect(mockTable.delete).toHaveBeenCalled()
		})

		it("should throw error on delete failure", async () => {
			mockTable.delete.mockRejectedValue(new Error("fail"))
			await expect(store.deletePointsByMultipleFilePaths(["a"])).rejects.toThrow()
		})
	})

	describe("deleteCollection", () => {
		it("should remove dbPath if exists", async () => {
			vi.spyOn(fs, "existsSync").mockResolvedValue(true)
			vi.spyOn(fs, "rmSync").mockImplementation(() => {})
			await expect(store.deleteCollection()).resolves.toBeUndefined()
			expect(fs.rmSync).toHaveBeenCalled()
		})

		it("should clear tables if rmSync fails", async () => {
			vi.spyOn(fs, "existsSync").mockResolvedValue(true)
			vi.spyOn(fs, "rmSync").mockImplementation(() => {
				throw new Error("fail")
			})
			mockDb.tableNames.mockImplementation(() => ["vector"])
			mockDb.dropTable.mockResolvedValue(undefined)
			await expect(store.deleteCollection()).rejects.toThrow()
			expect(mockDb.dropTable).toHaveBeenCalled()
		})
	})

	describe("clearCollection", () => {
		it("should delete all records from table and metadata", async () => {
			mockTable.delete.mockResolvedValue(undefined)
			mockDb.tableNames.mockResolvedValue(["metadata"])
			mockDb.openTable.mockResolvedValue(mockTable)
			mockTable.delete.mockResolvedValue(undefined)
			await expect(store.clearCollection()).resolves.toBeUndefined()
			expect(mockTable.delete).toHaveBeenCalledWith("true")
		})

		it("should warn if metadata table clear fails", async () => {
			mockTable.delete.mockResolvedValue(undefined)
			mockDb.tableNames.mockResolvedValue(["metadata"])
			mockDb.openTable.mockRejectedValue(new Error("fail"))
			await expect(store.clearCollection()).resolves.toBeUndefined()
		})

		it("should throw error on main table clear failure", async () => {
			mockTable.delete.mockRejectedValue(new Error("fail"))
			await expect(store.clearCollection()).rejects.toThrow()
		})
	})

	describe("collectionExists", () => {
		it("should return true if vector table exists", async () => {
			mockDb.tableNames.mockResolvedValue(["vector"])
			const exists = await store.collectionExists()
			expect(exists).toBe(true)
		})

		it("should return false if vector table does not exist", async () => {
			mockDb.tableNames.mockResolvedValue([])
			const exists = await store.collectionExists()
			expect(exists).toBe(false)
		})

		it("should return false on error", async () => {
			mockDb.tableNames.mockRejectedValue(new Error("fail"))
			const exists = await store.collectionExists()
			expect(exists).toBe(false)
		})
	})

	describe("isPayloadValid", () => {
		it("should return false for null/undefined", () => {
			expect(store["isPayloadValid"](null)).toBe(false)
			expect(store["isPayloadValid"](undefined)).toBe(false)
		})

		it("should return false for missing keys", () => {
			expect(store["isPayloadValid"]({ filePath: "a" })).toBe(false)
		})

		it("should return true for valid payload", () => {
			const payload: Payload = { filePath: "a", codeChunk: "b", startLine: 1, endLine: 2 }
			expect(store["isPayloadValid"](payload)).toBe(true)
		})
	})

	describe("escapeSqlString", () => {
		it("should double single quotes", () => {
			expect(store["escapeSqlString"]("O'Reilly")).toBe("O''Reilly")
		})

		it("should handle SQL injection attempts", () => {
			expect(store["escapeSqlString"]("' OR '1'='1")).toBe("'' OR ''1''=''1")
		})

		it("should handle multiple consecutive quotes", () => {
			expect(store["escapeSqlString"]("''")).toBe("''''")
		})

		it("should handle empty strings", () => {
			expect(store["escapeSqlString"]("")).toBe("")
		})

		it("should preserve backslashes", () => {
			expect(store["escapeSqlString"]("C:\\Users\\test")).toBe("C:\\Users\\test")
		})

		it("should handle strings with no special characters", () => {
			expect(store["escapeSqlString"]("normalstring")).toBe("normalstring")
		})

		it("should handle unicode characters", () => {
			expect(store["escapeSqlString"]("test's 文件")).toBe("test''s 文件")
		})

		it("should prevent comment injection attempts", () => {
			expect(store["escapeSqlString"]("test' --")).toBe("test'' --")
		})
	})

	describe("escapeSqlLikePattern", () => {
		it("should escape percent signs", () => {
			expect(store["escapeSqlLikePattern"]("50%")).toBe("50\\%")
		})

		it("should escape underscores", () => {
			expect(store["escapeSqlLikePattern"]("test_file")).toBe("test\\_file")
		})

		it("should escape both quotes and wildcards", () => {
			expect(store["escapeSqlLikePattern"]("test'_%")).toBe("test''\\_\\%")
		})

		it("should handle empty strings", () => {
			expect(store["escapeSqlLikePattern"]("")).toBe("")
		})

		it("should handle multiple wildcards", () => {
			expect(store["escapeSqlLikePattern"]("%%__")).toBe("\\%\\%\\_\\_")
		})

		it("should escape quotes before wildcards", () => {
			const result = store["escapeSqlLikePattern"]("path's%file_name")
			expect(result).toBe("path''s\\%file\\_name")
		})

		it("should escape backslashes in Windows paths", () => {
			expect(store["escapeSqlLikePattern"]("C:\\Users\\test")).toBe("C:\\\\Users\\\\test")
		})

		it("should escape backslashes before wildcards", () => {
			expect(store["escapeSqlLikePattern"]("C:\\test_file%")).toBe("C:\\\\test\\_file\\%")
		})

		it("should handle backslash at end", () => {
			expect(store["escapeSqlLikePattern"]("path\\")).toBe("path\\\\")
		})
	})

	describe("SQL Injection Prevention", () => {
		it("should prevent injection via IDs in upsertPoints", async () => {
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
			await store.upsertPoints(points)

			// Verify the delete call used properly escaped ID with IN clause
			expect(mockTable.delete).toHaveBeenCalledWith("id IN ('test'' OR id != ''')")
		})

		it("should prevent injection via multiple IDs", async () => {
			const points = [
				{
					id: "normal",
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
			await store.upsertPoints(points)

			expect(mockTable.delete).toHaveBeenCalledWith("id IN ('normal', ''' OR ''1''=''1')")
		})

		it("should prevent injection via directory prefix in search", async () => {
			const maliciousPrefix = "src' OR '1'='1"
			const whereSpy = vi.fn().mockReturnThis()
			mockTable.search.mockResolvedValue({
				where: whereSpy,
				distanceType: vi.fn().mockReturnThis(),
				distanceRange: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockResolvedValue([]),
			})

			await store.search([1, 2, 3], maliciousPrefix)

			// Verify proper escaping in the where clause
			expect(whereSpy).toHaveBeenCalledWith("`filePath` LIKE 'src'' OR ''1''=''1%'")
		})

		it("should prevent injection with wildcards in directory prefix", async () => {
			const maliciousPrefix = "50%_test"
			const whereSpy = vi.fn().mockReturnThis()
			mockTable.search.mockResolvedValue({
				where: whereSpy,
				distanceType: vi.fn().mockReturnThis(),
				distanceRange: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockResolvedValue([]),
			})

			await store.search([1, 2, 3], maliciousPrefix)

			expect(whereSpy).toHaveBeenCalledWith("`filePath` LIKE '50\\%\\_test%'")
		})

		it("should handle Windows paths with backslashes in search", async () => {
			const windowsPrefix = "C:\\Users\\test"
			const whereSpy = vi.fn().mockReturnThis()
			mockTable.search.mockResolvedValue({
				where: whereSpy,
				distanceType: vi.fn().mockReturnThis(),
				distanceRange: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockResolvedValue([]),
			})

			await store.search([1, 2, 3], windowsPrefix)

			// Backslashes should be escaped in LIKE patterns
			expect(whereSpy).toHaveBeenCalledWith("`filePath` LIKE 'C:\\\\Users\\\\test%'")
		})

		it("should prevent injection via file paths in deletePointsByFilePath", async () => {
			const maliciousPath = "file.ts' OR '1'='1"
			mockTable.delete.mockResolvedValue(undefined)

			await store.deletePointsByFilePath(maliciousPath)

			expect(mockTable.delete).toHaveBeenCalledWith("`filePath` IN ('file.ts'' OR ''1''=''1')")
		})

		it("should prevent injection via multiple file paths in deletePointsByMultipleFilePaths", async () => {
			const paths = ["normal.ts", "file' OR '1'='1.ts", "another.ts"]
			mockTable.delete.mockResolvedValue(undefined)

			await store.deletePointsByMultipleFilePaths(paths)

			expect(mockTable.delete).toHaveBeenCalledWith(
				"`filePath` IN ('normal.ts', 'file'' OR ''1''=''1.ts', 'another.ts')",
			)
		})

		it("should handle paths with backslashes safely", async () => {
			const windowsPath = "C:\\Users\\test\\file.ts"
			mockTable.delete.mockResolvedValue(undefined)

			await store.deletePointsByFilePath(windowsPath)

			// Backslashes should be preserved, only quotes escaped
			expect(mockTable.delete).toHaveBeenCalledWith(`\`filePath\` IN ('C:\\Users\\test\\file.ts')`)
		})
	})
})
