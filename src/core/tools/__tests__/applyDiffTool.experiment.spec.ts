import { EXPERIMENT_IDS } from "../../../shared/experiments"
import { TOOL_PROTOCOL } from "@roo-code/types"

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
}))

// Mock the ApplyDiffTool module
vi.mock("../ApplyDiffTool", () => ({
	applyDiffTool: {
		handle: vi.fn(),
	},
}))

// Import after mocking to get the mocked version
import { applyDiffTool as multiApplyDiffTool } from "../MultiApplyDiffTool"
import { applyDiffTool as applyDiffToolClass } from "../ApplyDiffTool"

describe("applyDiffTool experiment routing", () => {
	let mockCline: any
	let mockBlock: any
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockRemoveClosingTag: any
	let mockProvider: any

	beforeEach(async () => {
		vi.clearAllMocks()

		// Reset vscode mock to default behavior (XML protocol)
		const vscode = await import("vscode")
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: vi.fn().mockReturnValue(TOOL_PROTOCOL.XML),
		} as any)

		mockProvider = {
			getState: vi.fn(),
		}

		mockCline = {
			providerRef: {
				deref: vi.fn().mockReturnValue(mockProvider),
			},
			cwd: "/test",
			diffStrategy: {
				applyDiff: vi.fn(),
				getProgressStatus: vi.fn(),
			},
			diffViewProvider: {
				reset: vi.fn(),
			},
			apiConfiguration: {
				apiProvider: "anthropic",
			},
			api: {
				getModel: vi.fn().mockReturnValue({
					id: "test-model",
					info: {
						maxTokens: 4096,
						contextWindow: 128000,
						supportsPromptCache: false,
						supportsNativeTools: false,
					},
				}),
			},
			processQueuedMessages: vi.fn(),
		} as any

		mockBlock = {
			params: {
				path: "test.ts",
				diff: "test diff",
			},
			partial: false,
		}

		mockAskApproval = vi.fn()
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()
		mockRemoveClosingTag = vi.fn((tag, value) => value)
	})

	it("should always use class-based tool with native protocol (XML deprecated)", async () => {
		mockProvider.getState.mockResolvedValue({
			experiments: {
				[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF]: false,
			},
		})

		// Mock the class-based tool to resolve successfully
		;(applyDiffToolClass.handle as any).mockResolvedValue(undefined)

		await multiApplyDiffTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Always uses native protocol now (XML deprecated)
		expect(applyDiffToolClass.handle).toHaveBeenCalledWith(mockCline, mockBlock, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "native",
		})
	})

	it("should use class-based tool when experiments are not defined", async () => {
		mockProvider.getState.mockResolvedValue({})

		// Mock the class-based tool to resolve successfully
		;(applyDiffToolClass.handle as any).mockResolvedValue(undefined)

		await multiApplyDiffTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Always uses native protocol now (XML deprecated)
		expect(applyDiffToolClass.handle).toHaveBeenCalledWith(mockCline, mockBlock, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "native",
		})
	})

	it("should use class-based tool when MULTI_FILE_APPLY_DIFF experiment is enabled (native protocol always used)", async () => {
		mockProvider.getState.mockResolvedValue({
			experiments: {
				[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF]: true,
			},
		})

		// Mock the class-based tool to resolve successfully
		;(applyDiffToolClass.handle as any).mockResolvedValue(undefined)

		await multiApplyDiffTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Native protocol is always used now, so class-based tool is always called
		expect(applyDiffToolClass.handle).toHaveBeenCalledWith(mockCline, mockBlock, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "native",
		})
	})

	it("should use class-based tool when model defaults to native protocol", async () => {
		// Update model to support native tools and default to native protocol
		mockCline.api.getModel = vi.fn().mockReturnValue({
			id: "test-model",
			info: {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				supportsNativeTools: true, // Model supports native tools
				defaultToolProtocol: "native", // Model defaults to native protocol
			},
		})

		mockProvider.getState.mockResolvedValue({
			experiments: {
				[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF]: true,
			},
		})
		;(applyDiffToolClass.handle as any).mockResolvedValue(undefined)

		await multiApplyDiffTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// When native protocol is used, should always use class-based tool
		expect(applyDiffToolClass.handle).toHaveBeenCalledWith(mockCline, mockBlock, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "native",
		})
	})
})
