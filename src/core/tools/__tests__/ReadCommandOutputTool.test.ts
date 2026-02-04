import * as fs from "fs/promises"
import * as path from "path"
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"

import { ReadCommandOutputTool } from "../ReadCommandOutputTool"
import { Task } from "../../task/Task"

// Mock filesystem operations
vi.mock("fs/promises", () => ({
	default: {
		access: vi.fn(),
		stat: vi.fn(),
		open: vi.fn(),
		readFile: vi.fn(),
	},
	access: vi.fn(),
	stat: vi.fn(),
	open: vi.fn(),
	readFile: vi.fn(),
}))

// Mock getTaskDirectoryPath
vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi.fn((globalStoragePath: string, taskId: string) => {
		return path.join(globalStoragePath, "tasks", taskId)
	}),
}))

describe("ReadCommandOutputTool", () => {
	let tool: ReadCommandOutputTool
	let mockTask: any
	let mockCallbacks: any
	let mockFileHandle: any
	let globalStoragePath: string
	let taskId: string

	beforeEach(() => {
		vi.clearAllMocks()

		tool = new ReadCommandOutputTool()
		globalStoragePath = "/mock/global/storage"
		taskId = "task-123"

		// Mock task object
		mockTask = {
			taskId,
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			say: vi.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter"),
			recordToolError: vi.fn(),
			providerRef: {
				deref: vi.fn().mockResolvedValue({
					context: {
						globalStorageUri: {
							fsPath: globalStoragePath,
						},
					},
				}),
			},
		}

		// Mock callbacks
		mockCallbacks = {
			pushToolResult: vi.fn(),
		}

		// Mock file handle
		mockFileHandle = {
			read: vi.fn(),
			close: vi.fn().mockResolvedValue(undefined),
		}

		// Default mocks
		vi.mocked(fs.access).mockResolvedValue(undefined)
		vi.mocked(fs.stat).mockResolvedValue({ size: 1000 } as any)
		vi.mocked(fs.open).mockResolvedValue(mockFileHandle as any)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("Basic read functionality", () => {
		it("should read artifact file correctly", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "Line 1\nLine 2\nLine 3\n"
			const buffer = Buffer.from(content)

			mockFileHandle.read.mockImplementation((buf: Buffer) => {
				buffer.copy(buf)
				return Promise.resolve({ bytesRead: buffer.length })
			})

			await tool.execute({ artifact_id: artifactId }, mockTask, mockCallbacks)

			expect(fs.access).toHaveBeenCalledWith(
				path.join(globalStoragePath, "tasks", taskId, "command-output", artifactId),
			)
			expect(mockCallbacks.pushToolResult).toHaveBeenCalled()
			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain("Line 1")
			expect(result).toContain("Line 2")
			expect(result).toContain("Line 3")
		})

		it("should return content with line numbers", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "First line\nSecond line\nThird line\n"
			const buffer = Buffer.from(content)

			mockFileHandle.read.mockImplementation((buf: Buffer) => {
				buffer.copy(buf)
				return Promise.resolve({ bytesRead: buffer.length })
			})

			await tool.execute({ artifact_id: artifactId }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toMatch(/1 \| First line/)
			expect(result).toMatch(/2 \| Second line/)
			expect(result).toMatch(/3 \| Third line/)
		})

		it("should include size metadata in output", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "Test output"
			const fileSize = 5000
			const buffer = Buffer.from(content)

			vi.mocked(fs.stat).mockResolvedValue({ size: fileSize } as any)
			mockFileHandle.read.mockImplementation((buf: Buffer) => {
				buffer.copy(buf)
				return Promise.resolve({ bytesRead: buffer.length })
			})

			await tool.execute({ artifact_id: artifactId }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain(`[Command Output: ${artifactId}]`)
			expect(result).toContain("Total size:")
			expect(result).toMatch(/\d+(\.\d+)?(bytes|KB|MB)/)
		})

		it("should close file handle after reading", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "Test"
			const buffer = Buffer.from(content)

			mockFileHandle.read.mockImplementation((buf: Buffer) => {
				buffer.copy(buf)
				return Promise.resolve({ bytesRead: buffer.length })
			})

			await tool.execute({ artifact_id: artifactId }, mockTask, mockCallbacks)

			expect(mockFileHandle.close).toHaveBeenCalled()
		})
	})

	describe("Pagination (offset/limit)", () => {
		it("should use default limit of 40KB", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const largeContent = "x".repeat(50 * 1024) // 50KB
			const fileSize = Buffer.byteLength(largeContent, "utf8")

			vi.mocked(fs.stat).mockResolvedValue({ size: fileSize } as any)

			// Mock read to return only up to default limit (40KB)
			mockFileHandle.read.mockImplementation((buf: Buffer) => {
				const defaultLimit = 40 * 1024
				const bytesToRead = Math.min(buf.length, defaultLimit)
				buf.write(largeContent.slice(0, bytesToRead))
				return Promise.resolve({ bytesRead: bytesToRead })
			})

			await tool.execute({ artifact_id: artifactId }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain("TRUNCATED")
		})

		it("should start reading from custom offset", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "0123456789ABCDEFGHIJ"
			const offset = 10
			const fileSize = Buffer.byteLength(content, "utf8")

			vi.mocked(fs.stat).mockResolvedValue({ size: fileSize } as any)

			// Mock first read for offset calculation (returns content before offset)
			// Mock second read for actual content
			let readCallCount = 0
			mockFileHandle.read.mockImplementation(
				(buf: Buffer, bufOffset: number, length: number, position: number | null) => {
					readCallCount++
					if (position === 0) {
						// First read: prefix for line number calculation
						const prefixContent = content.slice(0, offset)
						buf.write(prefixContent)
						return Promise.resolve({ bytesRead: prefixContent.length })
					} else {
						// Second read: actual content from offset
						const actualContent = content.slice(offset)
						buf.write(actualContent)
						return Promise.resolve({ bytesRead: actualContent.length })
					}
				},
			)

			await tool.execute({ artifact_id: artifactId, offset }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain(`Showing bytes ${offset}-`)
			expect(mockFileHandle.read).toHaveBeenCalled()
		})

		it("should restrict output size with custom limit", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const largeContent = "x".repeat(10000)
			const customLimit = 1000
			const fileSize = Buffer.byteLength(largeContent, "utf8")

			vi.mocked(fs.stat).mockResolvedValue({ size: fileSize } as any)

			mockFileHandle.read.mockImplementation((buf: Buffer) => {
				const bytesToRead = Math.min(buf.length, customLimit)
				buf.write(largeContent.slice(0, bytesToRead))
				return Promise.resolve({ bytesRead: bytesToRead })
			})

			await tool.execute({ artifact_id: artifactId, limit: customLimit }, mockTask, mockCallbacks)

			expect(mockCallbacks.pushToolResult).toHaveBeenCalled()
			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain("TRUNCATED")
		})

		it("should show TRUNCATED when more content exists", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const fileSize = 10000
			const limit = 5000

			vi.mocked(fs.stat).mockResolvedValue({ size: fileSize } as any)

			mockFileHandle.read.mockImplementation((buf: Buffer) => {
				const content = "x".repeat(limit)
				buf.write(content)
				return Promise.resolve({ bytesRead: limit })
			})

			await tool.execute({ artifact_id: artifactId, limit }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain("TRUNCATED")
		})

		it("should show COMPLETE when all content is returned", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "Small content"
			const fileSize = Buffer.byteLength(content, "utf8")

			vi.mocked(fs.stat).mockResolvedValue({ size: fileSize } as any)

			mockFileHandle.read.mockImplementation((buf: Buffer) => {
				buf.write(content)
				return Promise.resolve({ bytesRead: fileSize })
			})

			await tool.execute({ artifact_id: artifactId }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain("COMPLETE")
			expect(result).not.toContain("TRUNCATED")
		})
	})

	describe("Search filtering", () => {
		// Helper to setup file handle mock for search (which now uses streaming)
		const setupSearchMock = (content: string) => {
			const buffer = Buffer.from(content)
			const fileSize = buffer.length
			vi.mocked(fs.stat).mockResolvedValue({ size: fileSize } as any)

			// Mock streaming read - return entire content in one chunk (simulates small file)
			mockFileHandle.read.mockImplementation(
				(buf: Buffer, bufOffset: number, length: number, position: number | null) => {
					const pos = position ?? 0
					if (pos >= fileSize) {
						return Promise.resolve({ bytesRead: 0 })
					}
					const bytesToRead = Math.min(length, fileSize - pos)
					buffer.copy(buf, 0, pos, pos + bytesToRead)
					return Promise.resolve({ bytesRead: bytesToRead })
				},
			)
		}

		it("should filter lines matching pattern", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "Line 1: error occurred\nLine 2: success\nLine 3: error found\nLine 4: complete\n"

			setupSearchMock(content)

			await tool.execute({ artifact_id: artifactId, search: "error" }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain("error occurred")
			expect(result).toContain("error found")
			expect(result).not.toContain("success")
			expect(result).not.toContain("complete")
		})

		it("should use case-insensitive matching", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "ERROR: Something bad\nwarning: minor issue\nERROR: Another problem\n"

			setupSearchMock(content)

			await tool.execute({ artifact_id: artifactId, search: "error" }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain("ERROR: Something bad")
			expect(result).toContain("ERROR: Another problem")
		})

		it("should show match count and line numbers", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "Line 1\nError on line 2\nLine 3\nError on line 4\n"

			setupSearchMock(content)

			await tool.execute({ artifact_id: artifactId, search: "Error" }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain("Total matches: 2")
			expect(result).toMatch(/2 \|.*Error on line 2/)
			expect(result).toMatch(/4 \|.*Error on line 4/)
		})

		it("should handle empty search results gracefully", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "Line 1\nLine 2\nLine 3\n"

			setupSearchMock(content)

			await tool.execute({ artifact_id: artifactId, search: "NOTFOUND" }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain("No matches found for the search pattern")
		})

		it("should handle regex patterns in search", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "test123\ntest456\nabc789\ntest000\n"

			setupSearchMock(content)

			await tool.execute({ artifact_id: artifactId, search: "test\\d+" }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain("test123")
			expect(result).toContain("test456")
			expect(result).toContain("test000")
			expect(result).not.toContain("abc789")
		})

		it("should handle invalid regex patterns by treating as literal", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "Line with [brackets]\nLine without\n"

			setupSearchMock(content)

			// Invalid regex but valid as literal string
			await tool.execute({ artifact_id: artifactId, search: "[" }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			expect(result).toContain("[brackets]")
		})
	})

	describe("Error handling", () => {
		it("should return error for non-existent artifact", async () => {
			const artifactId = "cmd-9999999999.txt"

			vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"))

			await tool.execute({ artifact_id: artifactId }, mockTask, mockCallbacks)

			expect(mockTask.didToolFailInCurrentTurn).toBe(true)
			expect(mockTask.say).toHaveBeenCalledWith("error", expect.stringContaining("not found"))
			expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Error: Artifact not found"),
			)
		})

		it("should reject invalid artifact_id with path traversal attempt", async () => {
			const invalidIds = [
				"../../../etc/passwd",
				"..\\..\\..\\windows\\system32\\config",
				"cmd-123/../other.txt",
				"cmd-<script>alert()</script>.txt",
				"cmd-.txt",
				"invalid-format.txt",
			]

			for (const invalidId of invalidIds) {
				vi.clearAllMocks()
				mockTask.consecutiveMistakeCount = 0
				mockTask.didToolFailInCurrentTurn = false

				await tool.execute({ artifact_id: invalidId }, mockTask, mockCallbacks)

				expect(mockTask.consecutiveMistakeCount).toBeGreaterThan(0)
				expect(mockTask.didToolFailInCurrentTurn).toBe(true)
				expect(mockTask.say).toHaveBeenCalledWith(
					"error",
					expect.stringContaining("Invalid artifact_id format"),
				)
			}
		})

		it("should accept valid artifact_id format", async () => {
			const validId = "cmd-1706119234567.txt"
			const content = "Test"
			const buffer = Buffer.from(content)

			mockFileHandle.read.mockImplementation((buf: Buffer) => {
				buffer.copy(buf)
				return Promise.resolve({ bytesRead: buffer.length })
			})

			await tool.execute({ artifact_id: validId }, mockTask, mockCallbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.didToolFailInCurrentTurn).toBe(false)
		})

		it("should handle invalid offset gracefully", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const fileSize = 1000

			vi.mocked(fs.stat).mockResolvedValue({ size: fileSize } as any)

			await tool.execute(
				{ artifact_id: artifactId, offset: 2000 }, // Offset beyond file size
				mockTask,
				mockCallbacks,
			)

			expect(mockTask.say).toHaveBeenCalledWith("error", expect.stringContaining("Invalid offset"))
			expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Error: Invalid offset"))
		})

		it("should handle negative offset", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const fileSize = 1000

			vi.mocked(fs.stat).mockResolvedValue({ size: fileSize } as any)

			await tool.execute({ artifact_id: artifactId, offset: -10 }, mockTask, mockCallbacks)

			expect(mockTask.say).toHaveBeenCalledWith("error", expect.stringContaining("Invalid offset"))
		})

		it("should handle missing artifact_id parameter", async () => {
			await tool.execute({ artifact_id: "" }, mockTask, mockCallbacks)

			expect(mockTask.consecutiveMistakeCount).toBeGreaterThan(0)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("read_command_output")
			expect(mockTask.didToolFailInCurrentTurn).toBe(true)
			expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("read_command_output", "artifact_id")
		})

		it("should handle missing global storage path", async () => {
			const artifactId = "cmd-1706119234567.txt"

			mockTask.providerRef.deref.mockResolvedValue({
				context: {
					globalStorageUri: null,
				},
			})

			await tool.execute({ artifact_id: artifactId }, mockTask, mockCallbacks)

			expect(mockTask.say).toHaveBeenCalledWith(
				"error",
				expect.stringContaining("Global storage path is not available"),
			)
			expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Error"))
		})

		it("should handle file read errors", async () => {
			const artifactId = "cmd-1706119234567.txt"

			mockFileHandle.read.mockRejectedValue(new Error("Read error"))

			await tool.execute({ artifact_id: artifactId }, mockTask, mockCallbacks)

			expect(mockTask.didToolFailInCurrentTurn).toBe(true)
			expect(mockTask.say).toHaveBeenCalledWith("error", expect.stringContaining("Error reading command output"))
		})

		it("should ensure file handle is closed even on error", async () => {
			const artifactId = "cmd-1706119234567.txt"

			mockFileHandle.read.mockRejectedValue(new Error("Read error"))

			await tool.execute({ artifact_id: artifactId }, mockTask, mockCallbacks)

			expect(mockFileHandle.close).toHaveBeenCalled()
		})
	})

	describe("Byte formatting", () => {
		it("should format bytes correctly", async () => {
			const testCases = [
				{ size: 500, expected: "bytes" },
				{ size: 1024, expected: "1.0KB" },
				{ size: 2048, expected: "2.0KB" },
				{ size: 1024 * 1024, expected: "1.0MB" },
				{ size: 2.5 * 1024 * 1024, expected: "2.5MB" },
			]

			for (const { size, expected } of testCases) {
				vi.clearAllMocks()
				const artifactId = "cmd-1706119234567.txt"
				const content = "x"
				const buffer = Buffer.from(content)

				vi.mocked(fs.stat).mockResolvedValue({ size } as any)
				mockFileHandle.read.mockImplementation((buf: Buffer) => {
					buffer.copy(buf)
					return Promise.resolve({ bytesRead: buffer.length })
				})

				await tool.execute({ artifact_id: artifactId }, mockTask, mockCallbacks)

				const result = mockCallbacks.pushToolResult.mock.calls[0][0]
				expect(result).toContain(expected)
			}
		})
	})

	describe("Line number calculation", () => {
		it("should calculate correct starting line number for offset", async () => {
			const artifactId = "cmd-1706119234567.txt"
			const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n"
			const offset = 14 // After "Line 1\nLine 2\n"
			const fileSize = Buffer.byteLength(content, "utf8")

			vi.mocked(fs.stat).mockResolvedValue({ size: fileSize } as any)

			let readCallCount = 0
			mockFileHandle.read.mockImplementation(
				(buf: Buffer, bufOffset: number, length: number, position: number | null) => {
					readCallCount++
					if (position === 0) {
						// Read prefix for line counting
						const prefix = content.slice(0, offset)
						buf.write(prefix)
						return Promise.resolve({ bytesRead: prefix.length })
					} else {
						// Read actual content from offset
						const actualContent = content.slice(offset)
						buf.write(actualContent)
						return Promise.resolve({ bytesRead: actualContent.length })
					}
				},
			)

			await tool.execute({ artifact_id: artifactId, offset }, mockTask, mockCallbacks)

			const result = mockCallbacks.pushToolResult.mock.calls[0][0]
			// Should start at line 3 since we skipped 2 newlines
			expect(result).toMatch(/3 \|/)
		})
	})
})
