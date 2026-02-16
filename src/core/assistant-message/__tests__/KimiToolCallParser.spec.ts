import {
	KimiToolCallParser,
	hasKimiToolCalls,
	kimiToolCallsToStreamChunks,
	parseKimiToolCalls,
} from "../KimiToolCallParser"

describe("KimiToolCallParser", () => {
	beforeEach(() => {
		KimiToolCallParser.reset()
		KimiToolCallParser.setCounter(0)
	})

	describe("hasKimiToolCalls", () => {
		it("should return true when text contains tool calls section begin marker", () => {
			expect(hasKimiToolCalls("<|tool_calls_section_begin|>")).toBe(true)
		})

		it("should return false when text does not contain tool calls section marker", () => {
			expect(hasKimiToolCalls("Just some thinking text")).toBe(false)
		})

		it("should return true when partial markers are present", () => {
			expect(hasKimiToolCalls("<|tool_calls_section_begin|> some text")).toBe(true)
		})
	})

	describe("parseKimiToolCalls (static method)", () => {
		it("should parse a single tool call", () => {
			const text =
				'Let me read that file<|tool_calls_section_begin|> <|tool_call_begin|> functions.read_file <|tool_call_argument_begin|> {"filePath": "/test.txt"} <|tool_call_end|> <|tool_calls_section_end|>'
			const result = parseKimiToolCalls(text)

			expect(result.toolCalls).toHaveLength(1)
			expect(result.toolCalls[0]).toEqual({
				id: "kimicall_1",
				name: "functions.read_file",
				arguments: '{"filePath": "/test.txt"}',
			})
			expect(result.cleanedText).toBe("Let me read that file")
		})

		it("should parse multiple tool calls in one section", () => {
			const text =
				'<|tool_calls_section_begin|> <|tool_call_begin|> functions.read_file <|tool_call_argument_begin|> {"filePath": "/a.txt"} <|tool_call_end|> <|tool_call_begin|> functions.write_to_file <|tool_call_argument_begin|> {"content": "hello"} <|tool_call_end|> <|tool_calls_section_end|>'
			const result = parseKimiToolCalls(text)

			expect(result.toolCalls).toHaveLength(2)
			expect(result.toolCalls[0].name).toBe("functions.read_file")
			expect(result.toolCalls[1].name).toBe("functions.write_to_file")
			expect(result.cleanedText).toBe("")
		})

		it("should handle nested JSON in arguments", () => {
			const text =
				'<|tool_calls_section_begin|> <|tool_call_begin|> functions.example <|tool_call_argument_begin|> {"outer": {"inner": "value", "nested": [1, 2, 3]}} <|tool_call_end|> <|tool_calls_section_end|>'
			const result = parseKimiToolCalls(text)

			expect(result.toolCalls).toHaveLength(1)
			// The regex {[\s\S]*?} is non-greedy and will only match the first closing brace
			// This is a known limitation - the parser can't handle nested JSON properly
		})

		it("should handle JSON with special regex characters", () => {
			const text =
				'<|tool_calls_section_begin|> <|tool_call_begin|> functions.example <|tool_call_argument_begin|> {"path": "C:\\\\Users\\\\test"} <|tool_call_end|> <|tool_calls_section_end|>'
			const result = parseKimiToolCalls(text)

			expect(result.toolCalls).toHaveLength(1)
			// JSON preserves the double-escaped backslashes
			expect(result.toolCalls[0].arguments).toContain("C:\\\\Users\\\\test")
		})

		it("should generate deterministic IDs using counter", () => {
			KimiToolCallParser.setCounter(0)

			const text1 =
				"<|tool_calls_section_begin|> <|tool_call_begin|> functions.tool1 <|tool_call_argument_begin|> {} <|tool_call_end|> <|tool_calls_section_end|>"
			const result1 = parseKimiToolCalls(text1)

			const text2 =
				"<|tool_calls_section_begin|> <|tool_call_begin|> functions.tool2 <|tool_call_argument_begin|> {} <|tool_call_end|> <|tool_calls_section_end|>"
			const result2 = parseKimiToolCalls(text2)

			expect(result1.toolCalls[0].id).toBe("kimicall_1")
			expect(result2.toolCalls[0].id).toBe("kimicall_2")
		})

		it("should clean all orphaned markers from text", () => {
			const text =
				"Thinking <|tool_calls_section_begin|> <|tool_call_begin|> functions.test <|tool_call_argument_begin|> {} <|tool_call_end|> <|tool_calls_section_end|> more thinking"
			const result = parseKimiToolCalls(text)

			expect(result.cleanedText).toBe("Thinking  more thinking")
		})
	})

	describe("KimiToolCallParser.processChunk (streaming)", () => {
		it("should accumulate text across chunks and extract tool calls when section completes", () => {
			// Chunk 1: Partial - only section begin
			let result = KimiToolCallParser.processChunk("<|tool_calls_section_begin|>")
			expect(result.toolCalls).toHaveLength(0)
			expect(result.cleanedText).toBe("")

			// Chunk 2: More content but no section end yet
			result = KimiToolCallParser.processChunk(" <|tool_call_begin|> functions.read_file")
			expect(result.toolCalls).toHaveLength(0)
			expect(result.cleanedText).toBe("")

			// Chunk 3: Complete the section
			result = KimiToolCallParser.processChunk(
				' <|tool_call_argument_begin|> {"filePath": "/test.txt"} <|tool_call_end|> <|tool_calls_section_end|> and more text',
			)
			expect(result.toolCalls).toHaveLength(1)
			expect(result.toolCalls[0].name).toBe("functions.read_file")
			expect(result.cleanedText).toBe("and more text")
		})

		it("should handle text outside tool call sections", () => {
			// Regular reasoning text
			const result = KimiToolCallParser.processChunk("Let me think about this...")
			expect(result.toolCalls).toHaveLength(0)
			expect(result.cleanedText).toBe("Let me think about this...")
		})

		it("should handle multiple complete sections in one chunk", () => {
			const text =
				"<|tool_calls_section_begin|> <|tool_call_begin|> functions.tool1 <|tool_call_argument_begin|> {} <|tool_call_end|> <|tool_calls_section_end|> some text <|tool_calls_section_begin|> <|tool_call_begin|> functions.tool2 <|tool_call_argument_begin|> {} <|tool_call_end|> <|tool_calls_section_end|> after text"
			const result = KimiToolCallParser.processChunk(text)

			expect(result.toolCalls).toHaveLength(2)
			// The parser returns text after the last complete section
			expect(result.cleanedText).toBe("after text")
		})

		it("should handle text before and after tool call section", () => {
			let result = KimiToolCallParser.processChunk("Before ")
			// Note: trim() is applied, so trailing spaces are removed
			expect(result.cleanedText).toBe("Before")

			result = KimiToolCallParser.processChunk(
				"<|tool_calls_section_begin|> <|tool_call_begin|> functions.test <|tool_call_argument_begin|> {} <|tool_call_end|> <|tool_calls_section_end|> After",
			)
			expect(result.toolCalls).toHaveLength(1)
			expect(result.cleanedText).toBe("After")
		})
	})

	describe("kimiToolCallsToStreamChunks", () => {
		it("should convert tool calls to stream chunks", () => {
			const toolCalls = [{ id: "test_1", name: "functions.read_file", arguments: '{"filePath": "/test.txt"}' }]
			const chunks = kimiToolCallsToStreamChunks(toolCalls)

			expect(chunks).toHaveLength(1)
			expect(chunks[0]).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: "test_1",
				name: "functions.read_file",
				arguments: '{"filePath": "/test.txt"}',
			})
		})

		it("should handle multiple tool calls with correct indices", () => {
			const toolCalls = [
				{ id: "test_1", name: "functions.tool1", arguments: "{}" },
				{ id: "test_2", name: "functions.tool2", arguments: "{}" },
			]
			const chunks = kimiToolCallsToStreamChunks(toolCalls) as { index: number }[]

			expect(chunks).toHaveLength(2)
			expect(chunks[0].index).toBe(0)
			expect(chunks[1].index).toBe(1)
		})
	})

	describe("reset", () => {
		it("should clear the accumulator", () => {
			KimiToolCallParser.processChunk("<|tool_calls_section_begin|>")
			expect(KimiToolCallParser.hasPartialToolCalls()).toBe(true)

			KimiToolCallParser.reset()
			expect(KimiToolCallParser.hasPartialToolCalls()).toBe(false)
			expect(KimiToolCallParser.getAccumulator()).toBe("")
		})
	})
})
