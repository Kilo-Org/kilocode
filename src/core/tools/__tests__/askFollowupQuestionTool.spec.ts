import { askFollowupQuestionTool } from "../AskFollowupQuestionTool"
import { ToolUse } from "../../../shared/tools"
import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"

describe("askFollowupQuestionTool", () => {
	let mockCline: any
	let mockPushToolResult: any
	let toolResult: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockCline = {
			ask: vi.fn().mockResolvedValue({ text: "Test response" }),
			say: vi.fn().mockResolvedValue(undefined),
			consecutiveMistakeCount: 0,
			// kilocode_change start
			providerRef: {
				deref: () => ({
					getState: () => Promise.resolve({ yoloMode: false }),
				}),
			},
			// kilocode_change end
		}

		mockPushToolResult = vi.fn((result) => {
			toolResult = result
		})
	})

	it("should parse suggestions without mode attributes", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "ask_followup_question",
			params: {
				question: "What would you like to do?",
				follow_up: "<suggest>Option 1</suggest><suggest>Option 2</suggest>",
			},
			partial: false,
		}

		await askFollowupQuestionTool.handle(mockCline, block as ToolUse<"ask_followup_question">, {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: mockPushToolResult,
			removeClosingTag: vi.fn((tag, content) => content),
			toolProtocol: "xml",
		})

		expect(mockCline.ask).toHaveBeenCalledWith(
			"followup",
			expect.stringContaining('"suggest":[{"answer":"Option 1"},{"answer":"Option 2"}]'),
			false,
		)
	})

	it("should parse suggestions with mode attributes", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "ask_followup_question",
			params: {
				question: "What would you like to do?",
				follow_up: '<suggest mode="code">Write code</suggest><suggest mode="debug">Debug issue</suggest>',
			},
			partial: false,
		}

		await askFollowupQuestionTool.handle(mockCline, block as ToolUse<"ask_followup_question">, {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: mockPushToolResult,
			removeClosingTag: vi.fn((tag, content) => content),
			toolProtocol: "xml",
		})

		expect(mockCline.ask).toHaveBeenCalledWith(
			"followup",
			expect.stringContaining(
				'"suggest":[{"answer":"Write code","mode":"code"},{"answer":"Debug issue","mode":"debug"}]',
			),
			false,
		)
	})

	it("should handle mixed suggestions with and without mode attributes", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "ask_followup_question",
			params: {
				question: "What would you like to do?",
				follow_up: '<suggest>Regular option</suggest><suggest mode="architect">Plan architecture</suggest>',
			},
			partial: false,
		}

		await askFollowupQuestionTool.handle(mockCline, block as ToolUse<"ask_followup_question">, {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: mockPushToolResult,
			removeClosingTag: vi.fn((tag, content) => content),
			toolProtocol: "xml",
		})

		expect(mockCline.ask).toHaveBeenCalledWith(
			"followup",
			expect.stringContaining(
				'"suggest":[{"answer":"Regular option"},{"answer":"Plan architecture","mode":"architect"}]',
			),
			false,
		)
	})

	// kilocode_change start
	describe("yoloMode behavior", () => {
		it("should return error message when yoloMode is enabled", async () => {
			const yoloMockCline = {
				...mockCline,
				providerRef: {
					deref: () => ({
						getState: () => Promise.resolve({ yoloMode: true }),
					}),
				},
			}

			const block: ToolUse = {
				type: "tool_use",
				name: "ask_followup_question",
				params: {
					question: "What would you like to do?",
					follow_up: "<suggest>Option 1</suggest>",
				},
				partial: false,
			}

			await askFollowupQuestionTool.handle(yoloMockCline, block as ToolUse<"ask_followup_question">, {
				askApproval: vi.fn(),
				handleError: vi.fn(),
				pushToolResult: mockPushToolResult,
				removeClosingTag: vi.fn((tag, content) => content),
				toolProtocol: "xml",
			})

			// Should not call ask in yoloMode
			expect(yoloMockCline.ask).not.toHaveBeenCalled()
			// Should return an error message
			expect(toolResult).toContain("not available in yolo mode")
		})
	})
	// kilocode_change end

	describe("handlePartial with native protocol", () => {
		it("should only send question during partial streaming to avoid raw JSON display", async () => {
			const block: ToolUse<"ask_followup_question"> = {
				type: "tool_use",
				name: "ask_followup_question",
				params: {
					question: "What would you like to do?",
				},
				partial: true,
				nativeArgs: {
					question: "What would you like to do?",
					follow_up: [{ text: "Option 1", mode: "code" }, { text: "Option 2" }],
				},
			}

			await askFollowupQuestionTool.handle(mockCline, block, {
				askApproval: vi.fn(),
				handleError: vi.fn(),
				pushToolResult: mockPushToolResult,
				removeClosingTag: vi.fn((tag, content) => content || ""),
				toolProtocol: "native",
			})

			// During partial streaming, only the question should be sent (not JSON with suggestions)
			expect(mockCline.ask).toHaveBeenCalledWith("followup", "What would you like to do?", true)
		})

		it("should handle partial with question from params", async () => {
			const block: ToolUse<"ask_followup_question"> = {
				type: "tool_use",
				name: "ask_followup_question",
				params: {
					question: "Choose wisely",
				},
				partial: true,
			}

			await askFollowupQuestionTool.handle(mockCline, block, {
				askApproval: vi.fn(),
				handleError: vi.fn(),
				pushToolResult: mockPushToolResult,
				removeClosingTag: vi.fn((tag, content) => content || ""),
				toolProtocol: "xml",
			})

			expect(mockCline.ask).toHaveBeenCalledWith("followup", "Choose wisely", true)
		})
	})

	describe("NativeToolCallParser.createPartialToolUse for ask_followup_question", () => {
		beforeEach(() => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.clearRawChunkState()
		})

		it("should build nativeArgs with question and follow_up during streaming", () => {
			// Start a streaming tool call
			NativeToolCallParser.startStreamingToolCall("call_123", "ask_followup_question")

			// Simulate streaming JSON chunks
			const chunk1 = '{"question":"What would you like?","follow_up":[{"text":"Option 1","mode":"code"}'
			const result1 = NativeToolCallParser.processStreamingChunk("call_123", chunk1)

			expect(result1).not.toBeNull()
			expect(result1?.name).toBe("ask_followup_question")
			expect(result1?.params.question).toBe("What would you like?")
			expect(result1?.nativeArgs).toBeDefined()
			// Use type assertion to access the specific fields
			const nativeArgs = result1?.nativeArgs as {
				question: string
				follow_up?: Array<{ text: string; mode?: string }>
			}
			expect(nativeArgs?.question).toBe("What would you like?")
			// partial-json should parse the incomplete array
			expect(nativeArgs?.follow_up).toBeDefined()
		})

		it("should finalize with complete nativeArgs", () => {
			NativeToolCallParser.startStreamingToolCall("call_456", "ask_followup_question")

			// Add complete JSON
			const completeJson =
				'{"question":"Choose an option","follow_up":[{"text":"Yes","mode":"code"},{"text":"No","mode":null}]}'
			NativeToolCallParser.processStreamingChunk("call_456", completeJson)

			const result = NativeToolCallParser.finalizeStreamingToolCall("call_456")

			expect(result).not.toBeNull()
			expect(result?.type).toBe("tool_use")
			expect(result?.name).toBe("ask_followup_question")
			expect(result?.partial).toBe(false)
			// Type guard: regular tools have type 'tool_use', MCP tools have type 'mcp_tool_use'
			if (result?.type === "tool_use") {
				expect(result.nativeArgs).toEqual({
					question: "Choose an option",
					follow_up: [
						{ text: "Yes", mode: "code" },
						{ text: "No", mode: null },
					],
				})
			}
		})
	})
})
