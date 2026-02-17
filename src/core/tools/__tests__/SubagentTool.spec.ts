import {
	SUBAGENT_CANCELLED_MODEL_MESSAGE,
	SUBAGENT_CANCELLED_STRUCTURED_RESULT,
	SUBAGENT_FAILED_MODEL_MESSAGE,
	type SubagentStructuredResult,
} from "../../../shared/subagent"
import { subagentTool } from "../SubagentTool"
import type { ToolUse } from "../../../shared/tools"

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: (msg: string) => `Tool Error: ${msg}`,
		toolResult: (content: string) => content,
	},
}))

const mockRunSubagentInBackground =
	vi.fn<
		(p: {
			parentTaskId: string
			prompt: string
			subagentType: "general" | "explore"
		}) => Promise<string | SubagentStructuredResult>
	>()
const mockSay = vi.fn()
const mockPushToolResult = vi.fn()
const mockHandleError = vi.fn()
const mockSayAndCreateMissingParamError = vi.fn().mockResolvedValue("Missing param error")
const mockRecordToolError = vi.fn()

const mockTask = {
	taskId: "parent-1",
	consecutiveMistakeCount: 0,
	didToolFailInCurrentTurn: false,
	recordToolError: mockRecordToolError,
	sayAndCreateMissingParamError: mockSayAndCreateMissingParamError,
	say: mockSay,
	providerRef: {
		deref: () => ({
			runSubagentInBackground: mockRunSubagentInBackground,
		}),
	},
}

describe("SubagentTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRunSubagentInBackground.mockResolvedValue("Subagent completed successfully.")
	})

	describe("parseLegacy", () => {
		it("parses description, prompt, and subagent_type", () => {
			const params = subagentTool.parseLegacy({
				description: "Do something",
				prompt: "Detailed instructions",
				subagent_type: "explore",
			})
			expect(params).toEqual({
				description: "Do something",
				prompt: "Detailed instructions",
				subagent_type: "explore",
			})
		})

		it("defaults subagent_type to general when invalid", () => {
			const params = subagentTool.parseLegacy({
				description: "X",
				prompt: "Y",
				subagent_type: "invalid",
			})
			expect(params.subagent_type).toBe("general")
		})
	})

	describe("execute", () => {
		it("calls runSubagentInBackground and pushes result on success", async () => {
			const block: ToolUse<"subagent"> = {
				type: "tool_use",
				name: "subagent",
				params: {},
				partial: false,
				nativeArgs: {
					description: "Explore files",
					prompt: "List files in src/",
					subagent_type: "explore",
				},
			}

			await subagentTool.execute(block.nativeArgs!, mockTask as any, {
				askApproval: vi.fn(),
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: vi.fn(),
				toolProtocol: "native",
			})

			expect(mockRunSubagentInBackground).toHaveBeenCalledWith(
				expect.objectContaining({
					parentTaskId: "parent-1",
					prompt: "List files in src/",
					subagentType: "explore",
				}),
			)
			expect(mockRunSubagentInBackground).toHaveBeenCalledWith(
				expect.objectContaining({
					onProgress: expect.any(Function),
				}),
			)
			expect(mockSay).toHaveBeenCalled()
			expect(mockPushToolResult).toHaveBeenCalledWith("Subagent completed successfully.")
		})

		it("sends completed payload with resultCode/messageKey and pushes model message when result is structured (cancelled)", async () => {
			mockRunSubagentInBackground.mockResolvedValue(SUBAGENT_CANCELLED_STRUCTURED_RESULT)

			await subagentTool.execute(
				{ description: "Do X", prompt: "Do it", subagent_type: "general" },
				mockTask as any,
				{
					askApproval: vi.fn(),
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					removeClosingTag: vi.fn(),
					toolProtocol: "native",
				},
			)

			const sayCalls = mockSay.mock.calls
			const completedCall = sayCalls.find((c) => {
				try {
					const payload = JSON.parse(c[1])
					return payload.tool === "subagentCompleted"
				} catch {
					return false
				}
			})
			expect(completedCall).toBeDefined()
			const payload = JSON.parse(completedCall![1])
			expect(payload.resultCode).toBe("CANCELLED")
			expect(payload.messageKey).toBe("chat:subagents.cancelledByUser")
			expect(payload.result).toBe(SUBAGENT_CANCELLED_MODEL_MESSAGE)
			expect(mockPushToolResult).toHaveBeenCalledWith(SUBAGENT_CANCELLED_MODEL_MESSAGE)
		})

		it("pushes error when description is missing", async () => {
			await subagentTool.execute(
				{ description: "", prompt: "Do it", subagent_type: "general" },
				mockTask as any,
				{
					askApproval: vi.fn(),
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					removeClosingTag: vi.fn(),
					toolProtocol: "native",
				},
			)

			expect(mockRunSubagentInBackground).not.toHaveBeenCalled()
			expect(mockSayAndCreateMissingParamError).toHaveBeenCalledWith("subagent", "description")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing param error")
		})

		it("pushes error when prompt is missing", async () => {
			await subagentTool.execute({ description: "X", prompt: "", subagent_type: "general" }, mockTask as any, {
				askApproval: vi.fn(),
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: vi.fn(),
				toolProtocol: "native",
			})

			expect(mockRunSubagentInBackground).not.toHaveBeenCalled()
			expect(mockSayAndCreateMissingParamError).toHaveBeenCalledWith("subagent", "prompt")
		})

		it("logs error and pushes generic tool error when runSubagentInBackground rejects (no raw message leak)", async () => {
			mockRunSubagentInBackground.mockRejectedValue(new Error("API failed"))

			await subagentTool.execute({ description: "X", prompt: "Y", subagent_type: "general" }, mockTask as any, {
				askApproval: vi.fn(),
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: vi.fn(),
				toolProtocol: "native",
			})

			expect(mockHandleError).not.toHaveBeenCalled()
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining(SUBAGENT_FAILED_MODEL_MESSAGE))
			expect(mockRecordToolError).toHaveBeenCalledWith("subagent")
			const sayCalls = mockSay.mock.calls
			const completedCall = sayCalls.find((c) => {
				try {
					const payload = JSON.parse(c[1])
					return payload.tool === "subagentCompleted" && payload.error !== undefined
				} catch {
					return false
				}
			})
			expect(completedCall).toBeDefined()
			const payload = JSON.parse(completedCall![1])
			expect(payload.error).toBe(SUBAGENT_FAILED_MODEL_MESSAGE)
		})
	})
})
