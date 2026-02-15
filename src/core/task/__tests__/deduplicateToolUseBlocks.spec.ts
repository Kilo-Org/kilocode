import { Anthropic } from "@anthropic-ai/sdk"
import { TelemetryService } from "@roo-code/telemetry"
import { deduplicateToolUseBlocks, DuplicateToolUseError } from "../deduplicateToolUseBlocks"

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn(() => true),
		instance: {
			captureException: vi.fn(),
		},
	},
}))

// Helper factories to reduce boilerplate
const toolUse = (id: string, name = "read_file", input: object = {}) => ({ type: "tool_use" as const, id, name, input })

const text = (content: string) => ({ type: "text" as const, text: content })

const assistantMsg = (content: Anthropic.ContentBlockParam[]): Anthropic.MessageParam => ({
	role: "assistant",
	content,
})

describe("deduplicateToolUseBlocks", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("when there are no duplicates", () => {
		it("should return the message unchanged", () => {
			const msg = assistantMsg([
				text("Let me help you with that."),
				toolUse("tool-1"),
				toolUse("tool-2", "write_to_file", { path: "output.txt" }),
			])

			const result = deduplicateToolUseBlocks(msg)

			expect(result).toEqual(msg)
			expect(TelemetryService.instance.captureException).not.toHaveBeenCalled()
		})

		it("should return non-assistant messages unchanged", () => {
			const userMessage: Anthropic.MessageParam = {
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool-1", content: "Result" }],
			}

			const result = deduplicateToolUseBlocks(userMessage)

			expect(result).toEqual(userMessage)
		})

		it("should return string content unchanged", () => {
			const msg: Anthropic.MessageParam = { role: "assistant", content: "Just a text message" }

			const result = deduplicateToolUseBlocks(msg)

			expect(result).toEqual(msg)
		})
	})

	describe("when there are duplicate tool_use IDs", () => {
		it("should remove duplicate tool_use blocks with the same ID", () => {
			const msg = assistantMsg([
				toolUse("toolu_01ABU1BGwKQY5cGhzxVzF7QN", "ask_followup_question"),
				toolUse("toolu_01ABU1BGwKQY5cGhzxVzF7QN", "ask_followup_question"), // DUPLICATE
			])

			const result = deduplicateToolUseBlocks(msg)

			expect(Array.isArray(result.content)).toBe(true)
			const content = result.content as Anthropic.ContentBlockParam[]
			expect(content.length).toBe(1)
			expect((content[0] as Anthropic.ToolUseBlockParam).id).toBe("toolu_01ABU1BGwKQY5cGhzxVzF7QN")
		})

		it("should keep the first occurrence of duplicate IDs", () => {
			const msg = assistantMsg([
				toolUse("tool-dup", "read_file", { path: "first.txt" }),
				toolUse("tool-unique", "write_to_file", { path: "output.txt" }),
				toolUse("tool-dup", "read_file", { path: "second.txt" }), // DUPLICATE
			])

			const result = deduplicateToolUseBlocks(msg)

			const content = result.content as Anthropic.ContentBlockParam[]
			expect(content.length).toBe(2)
			expect((content[0] as Anthropic.ToolUseBlockParam).id).toBe("tool-dup")
			expect((content[0] as Anthropic.ToolUseBlockParam).input).toEqual({ path: "first.txt" })
			expect((content[1] as Anthropic.ToolUseBlockParam).id).toBe("tool-unique")
		})

		it("should preserve text blocks while removing duplicates", () => {
			const msg = assistantMsg([
				text("I'll read the file for you."),
				toolUse("tool-1"),
				toolUse("tool-1"), // DUPLICATE
			])

			const result = deduplicateToolUseBlocks(msg)

			const content = result.content as Anthropic.ContentBlockParam[]
			expect(content.length).toBe(2)
			expect(content[0].type).toBe("text")
			expect((content[0] as Anthropic.TextBlockParam).text).toBe("I'll read the file for you.")
			expect(content[1].type).toBe("tool_use")
			expect((content[1] as Anthropic.ToolUseBlockParam).id).toBe("tool-1")
		})

		it("should handle multiple duplicate IDs", () => {
			const msg = assistantMsg([
				toolUse("id-A"),
				toolUse("id-A"), // DUPLICATE
				toolUse("id-B", "write_to_file"),
				toolUse("id-B", "write_to_file"), // DUPLICATE
			])

			const result = deduplicateToolUseBlocks(msg)

			const content = result.content as Anthropic.ContentBlockParam[]
			expect(content.length).toBe(2)
			expect((content[0] as Anthropic.ToolUseBlockParam).id).toBe("id-A")
			expect((content[1] as Anthropic.ToolUseBlockParam).id).toBe("id-B")
		})

		it("should handle 3+ duplicates of the same ID", () => {
			const msg = assistantMsg([
				toolUse("same-id", "read_file", { v: 1 }),
				toolUse("same-id", "read_file", { v: 2 }),
				toolUse("same-id", "read_file", { v: 3 }),
				toolUse("same-id", "read_file", { v: 4 }),
				toolUse("same-id", "read_file", { v: 5 }),
			])

			const result = deduplicateToolUseBlocks(msg)

			const content = result.content as Anthropic.ContentBlockParam[]
			expect(content.length).toBe(1)
			expect((content[0] as Anthropic.ToolUseBlockParam).input).toEqual({ v: 1 })

			expect(TelemetryService.instance.captureException).toHaveBeenCalledWith(
				expect.any(DuplicateToolUseError),
				expect.objectContaining({
					duplicateIds: ["same-id"],
					totalToolUseCount: 5,
					uniqueToolUseCount: 1,
				}),
			)
		})

		it("should handle mixed content with text between duplicate tool_uses", () => {
			const msg = assistantMsg([
				text("Starting..."),
				toolUse("id-A", "read_file", { path: "a.txt" }),
				text("Middle text"),
				toolUse("id-B", "write_file", { path: "b.txt" }),
				toolUse("id-A", "read_file", { path: "a2.txt" }), // DUP
				text("More text"),
				toolUse("id-B", "write_file", { path: "b2.txt" }), // DUP
				text("Done"),
			])

			const result = deduplicateToolUseBlocks(msg)

			const content = result.content as Anthropic.ContentBlockParam[]
			expect(content.length).toBe(6) // 4 text + 2 unique tool_use
			expect(content[0].type).toBe("text")
			expect(content[1].type).toBe("tool_use")
			expect((content[1] as Anthropic.ToolUseBlockParam).id).toBe("id-A")
			expect(content[2].type).toBe("text")
			expect(content[3].type).toBe("tool_use")
			expect((content[3] as Anthropic.ToolUseBlockParam).id).toBe("id-B")
		})

		it("should keep tool_use blocks with invalid/missing IDs", () => {
			const msg = assistantMsg([
				toolUse("valid-id"),
				toolUse("", "empty_id"), // Empty ID - kept
				toolUse("valid-id"), // DUP
			])

			const result = deduplicateToolUseBlocks(msg)

			const content = result.content as Anthropic.ContentBlockParam[]
			expect(content.length).toBe(2) // valid-id + empty-id (kept), duplicate removed
		})

		it("should handle invalid IDs and valid duplicates together", () => {
			const msg = assistantMsg([
				toolUse("", "invalid_empty"), // Invalid - kept
				toolUse("valid-A", "read_file", { v: 1 }),
				toolUse("valid-A", "read_file", { v: 2 }), // DUP
				toolUse("valid-B", "write_file", { v: 1 }),
				toolUse("valid-B", "write_file", { v: 2 }), // DUP
			])

			const result = deduplicateToolUseBlocks(msg)

			const content = result.content as Anthropic.ContentBlockParam[]
			expect(content.length).toBe(3) // 1 invalid (kept) + 2 valid unique
			expect((content[0] as Anthropic.ToolUseBlockParam).id).toBe("")
			expect((content[1] as Anthropic.ToolUseBlockParam).id).toBe("valid-A")
			expect((content[2] as Anthropic.ToolUseBlockParam).id).toBe("valid-B")

			expect(TelemetryService.instance.captureException).toHaveBeenCalledWith(
				expect.any(DuplicateToolUseError),
				expect.objectContaining({
					duplicateIds: ["valid-A", "valid-B"],
					totalToolUseCount: 5,
					uniqueToolUseCount: 2,
				}),
			)
		})

		it("should not mutate the original message", () => {
			const msg = assistantMsg([toolUse("dup"), toolUse("dup")])

			deduplicateToolUseBlocks(msg)

			expect(msg.content).toHaveLength(2)
		})
	})

	describe("telemetry", () => {
		it("should report duplicates to telemetry", () => {
			const msg = assistantMsg([
				toolUse("tool-dup"),
				toolUse("tool-dup"), // DUPLICATE
			])

			deduplicateToolUseBlocks(msg)

			expect(TelemetryService.instance.captureException).toHaveBeenCalledTimes(1)
			expect(TelemetryService.instance.captureException).toHaveBeenCalledWith(
				expect.any(DuplicateToolUseError),
				expect.objectContaining({
					duplicateIds: ["tool-dup"],
					totalToolUseCount: 2,
					uniqueToolUseCount: 1,
				}),
			)
		})

		it("should not report when there are no duplicates", () => {
			const msg = assistantMsg([toolUse("tool-1")])

			deduplicateToolUseBlocks(msg)

			expect(TelemetryService.instance.captureException).not.toHaveBeenCalled()
		})
	})

	describe("DuplicateToolUseError", () => {
		it("should create error with correct properties", () => {
			const error = new DuplicateToolUseError("Duplicate detected", ["id-1", "id-2"], 5)

			expect(error.name).toBe("DuplicateToolUseError")
			expect(error.message).toBe("Duplicate detected")
			expect(error.duplicateIds).toEqual(["id-1", "id-2"])
			expect(error.totalToolUseCount).toBe(5)
		})
	})
})
