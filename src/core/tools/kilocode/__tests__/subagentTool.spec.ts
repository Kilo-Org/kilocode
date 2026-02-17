// npx vitest core/tools/kilocode/__tests__/subagentTool.spec.ts

import type { AskApproval, HandleError } from "../../../../shared/tools"

// Mock Package module
vi.mock("../../../../shared/package", () => ({
	Package: {
		name: "kilo-code",
		publisher: "Kilo-Org",
		version: "1.0.0",
		outputChannel: "Kilo-Code",
	},
}))

// Mock other modules first
vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Tool Error: ${msg}`),
		toolDenied: vi.fn(() => "Tool denied"),
	},
}))

vi.mock("../../../shared/modes", () => ({
	getModeBySlug: vi.fn(),
}))

// Mock other modules
const mockSay = vi.fn()
const mockPushToolResult = vi.fn()
const mockAsk = vi.fn()
const mockRecordToolError = vi.fn()
const mockEmit = vi.fn()
const mockSayAndCreateMissingParamError = vi.fn().mockResolvedValue("<error>Missing param</error>")

// Single provider object so tests can mutate spawnSubagent and tool sees it
const mockProviderObj = {
	spawnSubagent: vi.fn(),
	getState: vi.fn(() => Promise.resolve({})),
	log: vi.fn(),
}
const defaultDeref = vi.fn(() => mockProviderObj)

// Create mock Cline instance
const mockCline = {
	say: mockSay,
	pushToolResult: mockPushToolResult,
	ask: mockAsk,
	recordToolError: mockRecordToolError,
	sayAndCreateMissingParamError: mockSayAndCreateMissingParamError,
	consecutiveMistakeCount: 0,
	taskId: "mock-parent-task-id",
	enableCheckpoints: false,
	checkpointSave: vi.fn(),
	providerRef: {
		deref: defaultDeref,
	},
}

// Mock the subagentTool
import { subagentTool } from "../subagentTool"

const mockAskApproval = vi.fn<AskApproval>()
const mockHandleError = vi.fn<HandleError>()
const mockRemoveClosingTag = vi.fn((_name: string, value: string | undefined) => value ?? "")

describe("subagentTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockSayAndCreateMissingParamError.mockResolvedValue("<error>Missing param</error>")
		mockCline.consecutiveMistakeCount = 0
		;(mockCline as any).providerRef.deref = defaultDeref
	})

	it("should parse legacy parameters correctly", () => {
		const params = subagentTool.parseLegacy({
			description: "List exports",
			prompt: "List all exports in the src directory",
			subagent_type: "explore",
		})

		expect(params.description).toBe("List exports")
		expect(params.prompt).toBe("List all exports in the src directory")
		expect(params.subagent_type).toBe("explore")
	})

	it("should handle missing description parameter", async () => {
		const block = {
			params: {
				prompt: "Do something",
				subagent_type: "general",
			},
			partial: false,
		}

		await subagentTool.handle(mockCline as any, block as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		expect(mockCline.recordToolError).toHaveBeenCalledWith("subagent")
		expect(mockPushToolResult).toHaveBeenCalled()
	})

	it("should handle missing prompt parameter", async () => {
		const block = {
			params: {
				description: "Test",
				subagent_type: "general",
			},
			partial: false,
		}

		await subagentTool.handle(mockCline as any, block as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		expect(mockCline.recordToolError).toHaveBeenCalledWith("subagent")
		expect(mockPushToolResult).toHaveBeenCalled()
	})

	it("should handle invalid subagent_type parameter", async () => {
		const block = {
			params: {
				description: "Test",
				prompt: "Do something",
				subagent_type: "invalid",
			},
			partial: false,
		}

		await subagentTool.handle(mockCline as any, block as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("subagent_type must be"))
	})

	it("should show launch message and spawn subagent on approval", async () => {
		const block = {
			params: {
				description: "Test subagent",
				prompt: "Do something interesting",
				subagent_type: "explore",
			},
			partial: false,
		}

		// Mock approval
		mockAskApproval.mockResolvedValue(true)
		mockProviderObj.spawnSubagent.mockResolvedValue({
			subagentTaskId: "subagent-123",
		})

		await subagentTool.handle(mockCline as any, block as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		// Verify launch message
		expect(mockCline.say).toHaveBeenCalledWith("text", "Launch Subagent: Test subagent")

		// Verify spawnSubagent was called
		expect(mockProviderObj.spawnSubagent).toHaveBeenCalledWith({
			description: "Test subagent",
			prompt: "Do something interesting",
			subagent_type: "explore",
			parentTaskId: "mock-parent-task-id",
		})

		// Verify result
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Subagent spawned with ID: subagent-123"),
		)
	})

	it("should not spawn subagent when approval denied", async () => {
		const block = {
			params: {
				description: "Test subagent",
				prompt: "Do something",
				subagent_type: "general",
			},
			partial: false,
		}

		// Mock approval denial
		mockAskApproval.mockResolvedValue(false)

		await subagentTool.handle(mockCline as any, block as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		// Verify spawnSubagent was NOT called
		expect(mockProviderObj.spawnSubagent).not.toHaveBeenCalled()
	})

	it("should handle provider reference lost", async () => {
		const block = {
			params: {
				description: "Test",
				prompt: "Do something",
				subagent_type: "general",
			},
			partial: false,
		}

		mockAskApproval.mockResolvedValue(true)
		// Mock providerRef to return undefined (cast to any to allow undefined return)
		;(mockCline as any).providerRef.deref = vi.fn(() => undefined)

		await subagentTool.handle(mockCline as any, block as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Provider reference lost"))
	})

	it("should clear consecutive mistake count on successful execution", async () => {
		mockCline.consecutiveMistakeCount = 5

		const block = {
			params: {
				description: "Test",
				prompt: "Do something",
				subagent_type: "general",
			},
			partial: false,
		}

		mockAskApproval.mockResolvedValue(true)
		mockProviderObj.spawnSubagent.mockResolvedValue({
			subagentTaskId: "subagent-123",
		})

		await subagentTool.handle(mockCline as any, block as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		expect(mockCline.consecutiveMistakeCount).toBe(0)
	})
})
