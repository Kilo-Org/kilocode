// Import after mocking to get the mocked version
import { applyDiffToolLegacy } from "../applyDiffTool"

describe("applyDiffTool tool call parsing", () => {
	let mockCline: any
	let mockBlock: any
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockRemoveClosingTag: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockCline = {
			cwd: "/test",
			diffStrategy: {
				applyDiff: vi.fn().mockResolvedValue({ success: true, content: "file content" }),
				getProgressStatus: vi.fn(),
			},
			diffViewProvider: {
				reset: vi.fn(),
				open: vi.fn(),
				update: vi.fn(),
				scrollToFirstDiff: vi.fn(),
				saveChanges: vi.fn(),
				pushToolWriteResult: vi.fn(),
			},
			api: {
				getModel: vi.fn().mockReturnValue({ id: "test-model" }),
			},
			apiConfiguration: {
				toolCallEnabled: true,
			},
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn(),
			fileContextTracker: {
				trackFileContext: vi.fn(),
			},
			didEditFile: false,
			providerRef: {
				deref: () => ({
					getState: async () => ({}),
				}),
			},
			processQueuedMessages: vi.fn(),
			say: vi.fn(),
		}
		mockBlock = {
			params: { path: "test.ts" },
			toolUseParam: {
				input: {
					diff: [
						{
							start_line: 10,
							search: "search content",
							replace: "replace content",
						},
					],
				},
			},
			toolUseId: "test-1",
			partial: false,
		}
		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()
		mockRemoveClosingTag = vi.fn((tag, value) => value)

		// Mock file system checks
		vi.mock("fs/promises", () => ({
			readFile: vi.fn().mockResolvedValue("file content"),
			default: {
				readFile: vi.fn().mockResolvedValue("file content"),
			},
		}))
		vi.mock("../../../utils/fs", () => ({
			fileExistsAtPath: vi.fn().mockResolvedValue(true),
		}))
	})

	it("should format diffContent from toolUseParam when toolCallEnabled is true", async () => {
		await applyDiffToolLegacy(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		const expectedDiffContent = `<<<<<<< SEARCH\n:start_line:10\n-------\nsearch content\n=======\nreplace content\n>>>>>>> REPLACE\n\n`
		expect(mockBlock.params.diff).toEqual(expectedDiffContent)
	})

	it("should not modify diffContent if toolUseParam.input.diff is missing or empty", async () => {
		mockBlock.toolUseParam.input = {}
		mockBlock.params.diff = "original diff"

		await applyDiffToolLegacy(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockBlock.params.diff).toEqual("original diff")
	})
})
