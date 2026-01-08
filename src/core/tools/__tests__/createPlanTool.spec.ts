import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createPlanTool } from "../CreatePlanTool"
import { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import { getPlanFileSystem } from "../../../services/planning"

// Mock the planning service
vi.mock("../../../services/planning", () => ({
	getPlanFileSystem: vi.fn(() => ({
		createAndOpen: vi.fn(),
	})),
}))

// Mock vscode for integration tests - using vi.doMock to avoid hoisting issues
vi.doMock("vscode", () => ({
	Uri: {
		parse: vi.fn((str) => ({ scheme: "plan", path: str.replace("plan://", "/") })),
	},
	workspace: {
		fs: {
			readFile: vi.fn(),
			writeFile: vi.fn(),
		},
	},
	window: {
		showTextDocument: vi.fn().mockResolvedValue({}),
	},
	EventEmitter: vi.fn().mockImplementation(() => ({
		event: vi.fn(),
		fire: vi.fn(),
	})),
	FileSystemProvider: {
		asFileType: 1,
	},
	FileType: {
		File: 1,
	},
	FileChangeType: {
		Created: 1,
		Changed: 2,
		Deleted: 3,
	},
	FileSystemError: {
		FileNotFound: class extends Error {
			constructor(uri: any) {
				super(`File not found: ${uri}`)
				this.name = "FileNotFound"
			}
		} as any,
		NoPermissions: class extends Error {
			constructor() {
				super("No permissions")
				this.name = "NoPermissions"
			}
		} as any,
	},
	Disposable: vi.fn().mockImplementation(() => ({
		dispose: vi.fn(),
	})),
}))

describe("createPlanTool", () => {
	let mockTask: Task
	let mockPushToolResult: any
	let mockHandleError: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockPushToolResult = vi.fn()
		mockHandleError = vi.fn()

		// Create a mock Task object with required properties
		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			recordToolUsage: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
		} as unknown as Task
	})

	afterEach(() => {
		vi.resetAllMocks()
	})

	describe("parameter validation", () => {
		it("should error when title is missing", async () => {
			await createPlanTool.execute({ title: "", content: "test content" }, mockTask, {
				pushToolResult: mockPushToolResult,
				handleError: mockHandleError,
			} as any)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("create_plan")
			expect(mockPushToolResult).toHaveBeenCalled()
		})

		it("should error when content is missing (undefined)", async () => {
			await createPlanTool.execute({ title: "test-title", content: undefined as any }, mockTask, {
				pushToolResult: mockPushToolResult,
				handleError: mockHandleError,
			} as any)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("create_plan")
			expect(mockPushToolResult).toHaveBeenCalled()
		})

		it("should error when content is null", async () => {
			await createPlanTool.execute({ title: "test-title", content: null as any }, mockTask, {
				pushToolResult: mockPushToolResult,
				handleError: mockHandleError,
			} as any)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockPushToolResult).toHaveBeenCalled()
		})

		it("should error when title exceeds 255 characters", async () => {
			const longTitle = "a".repeat(256)

			await createPlanTool.execute({ title: longTitle, content: "test content" }, mockTask, {
				pushToolResult: mockPushToolResult,
				handleError: mockHandleError,
			} as any)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockPushToolResult).toHaveBeenCalledWith(
				formatResponse.toolError("Title must be 255 characters or less"),
			)
		})

		it("should error when content exceeds 1MB", async () => {
			const largeContent = "a".repeat(1000001)

			await createPlanTool.execute({ title: "test-title", content: largeContent }, mockTask, {
				pushToolResult: mockPushToolResult,
				handleError: mockHandleError,
			} as any)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockPushToolResult).toHaveBeenCalledWith(formatResponse.toolError("Content must be 1MB or less"))
		})
	})

	describe("parseLegacy", () => {
		it("should parse legacy XML parameters", () => {
			const result = createPlanTool.parseLegacy({
				title: "legacy-title",
				content: "legacy content",
			})

			expect(result).toEqual({
				title: "legacy-title",
				content: "legacy content",
			})
		})

		it("should return empty strings for missing parameters", () => {
			const result = createPlanTool.parseLegacy({})

			expect(result).toEqual({
				title: "",
				content: "",
			})
		})
	})

	describe("tool name", () => {
		it("should have correct name", () => {
			expect(createPlanTool.name).toBe("create_plan")
		})
	})

	describe("plan workflow integration", () => {
		it("should create plan with unique content", async () => {
			const mockFs = {
				createAndOpen: vi.fn().mockResolvedValue("plan://my-test.md"),
			}
			vi.mocked(getPlanFileSystem).mockReturnValue(mockFs as any)

			await createPlanTool.execute(
				{ title: "my-test", content: "# My Test Document\n\nTest content." },
				mockTask,
				{ pushToolResult: mockPushToolResult, handleError: mockHandleError } as any,
			)

			expect(mockFs.createAndOpen).toHaveBeenCalledWith("my-test", "# My Test Document\n\nTest content.")
			expect(mockPushToolResult).toHaveBeenCalled()
		})

		it("should handle multiple plan creations with different content", async () => {
			const mockFs = {
				createAndOpen: vi
					.fn()
					.mockResolvedValueOnce("plan://first.md")
					.mockResolvedValueOnce("plan://second.md"),
			}
			vi.mocked(getPlanFileSystem).mockReturnValue(mockFs as any)

			// Create first plan
			await createPlanTool.execute({ title: "first", content: "# First Plan\n\nContent one." }, mockTask, {
				pushToolResult: mockPushToolResult,
				handleError: mockHandleError,
			} as any)

			// Create second plan
			await createPlanTool.execute({ title: "second", content: "# Second Plan\n\nContent two." }, mockTask, {
				pushToolResult: mockPushToolResult,
				handleError: mockHandleError,
			} as any)

			// Verify both plans were created with their respective content
			expect(mockFs.createAndOpen).toHaveBeenCalledTimes(2)
			expect(mockFs.createAndOpen).toHaveBeenCalledWith("first", "# First Plan\n\nContent one.")
			expect(mockFs.createAndOpen).toHaveBeenCalledWith("second", "# Second Plan\n\nContent two.")
		})
	})
})
