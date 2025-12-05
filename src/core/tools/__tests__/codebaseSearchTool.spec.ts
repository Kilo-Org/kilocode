// kilocode_change: file added
import { beforeEach, describe, expect, it, vi } from "vitest"

import { codebaseSearchTool } from "../CodebaseSearchTool"
import { formatResponse } from "../../prompts/responses"
import { Task } from "../../task/Task"
import { CodeIndexManager } from "../../../services/code-index/manager"

vi.mock("../../../services/code-index/manager", () => ({
	CodeIndexManager: {
		getInstance: vi.fn(),
	},
}))

describe("codebaseSearchTool", () => {
	let mockTask: Partial<Task>
	let askApproval: ReturnType<typeof vi.fn>
	let handleError: ReturnType<typeof vi.fn>
	let pushToolResult: ReturnType<typeof vi.fn>
	let removeClosingTag: (tag: string, text?: string) => string
	let toolProtocol: "xml" | "native"

	beforeEach(() => {
		vi.clearAllMocks()

		mockTask = {
			cwd: "/repo",
			consecutiveMistakeCount: 0,
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn(),
			sayAndCreateMissingParamError: vi.fn(),
			providerRef: {
				deref: vi.fn().mockReturnValue({ context: {} }),
			} as any,
		}

		askApproval = vi.fn().mockResolvedValue(true)
		handleError = vi.fn()
		pushToolResult = vi.fn()
		removeClosingTag = vi.fn((_, text) => text || "")
		toolProtocol = "xml"
	})

	it("returns a friendly message when indexing is still in progress", async () => {
		const managerMock = {
			isFeatureEnabled: true,
			isFeatureConfigured: true,
			getCurrentStatus: vi.fn().mockReturnValue({
				systemStatus: "Indexing" as const,
				message: "Processing files",
				processedItems: 10,
				totalItems: 100,
				currentItemUnit: "files",
			}),
			searchIndex: vi.fn(),
		}

		vi.mocked(CodeIndexManager.getInstance).mockReturnValue(managerMock as any)

		const block = {
			type: "tool_use" as const,
			name: "codebase_search" as const,
			params: { query: "example" },
			partial: false,
		}

		await codebaseSearchTool.handle(mockTask as Task, block, {
			askApproval,
			handleError,
			pushToolResult,
			removeClosingTag,
			toolProtocol,
		})

		expect(managerMock.searchIndex).not.toHaveBeenCalled()
		expect(pushToolResult).toHaveBeenCalledTimes(1)
		const pushedMessage = pushToolResult.mock.calls[0][0] as string
		expect(pushedMessage).toBe(
			formatResponse.toolError(
				"Processing files (Progress: 10/100 files). Semantic search is unavailable until indexing completes. Please try again later.",
			),
		)

		expect(mockTask.say).toHaveBeenCalledTimes(1)
		const sayMock = mockTask.say as unknown as ReturnType<typeof vi.fn>
		const sayCall = sayMock.mock.calls[0]
		expect(sayCall[0]).toBe("codebase_search_result")
		const payload = JSON.parse(sayCall[1])
		expect(payload).toEqual({
			tool: "codebaseSearch",
			content: {
				query: "example",
				results: [],
				status: {
					systemStatus: "Indexing",
					message: "Processing files",
					processedItems: 10,
					totalItems: 100,
					currentItemUnit: "files",
				},
			},
		})
	})
})
