import { describe, it, expect } from "vitest"
import { tryParseJson, parseCliChunk, CliOutputParser, type StreamEvent } from "../CliOutputParser"

describe("tryParseJson", () => {
	it("should parse valid JSON", () => {
		const result = tryParseJson('{"timestamp":123,"source":"extension","type":"say"}')
		expect(result).toEqual({
			timestamp: 123,
			source: "extension",
			type: "say",
		})
	})

	it("should parse JSON with VT control codes", () => {
		const input = '\x1b[2K\x1b[1A\x1b[2K\x1b[G{"timestamp":123,"source":"extension","type":"say"}'
		const result = tryParseJson(input)
		expect(result).not.toBeNull()
		expect(result?.timestamp).toBe(123)
	})

	it("should return null for non-JSON", () => {
		expect(tryParseJson("not json")).toBeNull()
	})

	it("should return null for empty string", () => {
		expect(tryParseJson("")).toBeNull()
	})

	it("should return null for primitive JSON values", () => {
		expect(tryParseJson("123")).toBeNull()
		expect(tryParseJson('"string"')).toBeNull()
		expect(tryParseJson("true")).toBeNull()
	})
})

describe("parseCliChunk", () => {
	it("should parse a single JSON line", () => {
		const result = parseCliChunk('{"timestamp":123,"source":"extension","type":"say"}\n')
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toEqual({
			streamEventType: "kilocode",
			payload: {
				timestamp: 123,
				source: "extension",
				type: "say",
			},
		})
		expect(result.remainingBuffer).toBe("")
	})

	it("should parse session_created event from CLI", () => {
		const result = parseCliChunk('{"event":"session_created","sessionId":"sess-abc-123","timestamp":1234567890}\n')
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toEqual({
			streamEventType: "session_created",
			sessionId: "sess-abc-123",
			timestamp: 1234567890,
		})
	})

	it("should use current timestamp when session_created has no timestamp", () => {
		const before = Date.now()
		const result = parseCliChunk('{"event":"session_created","sessionId":"sess-xyz"}\n')
		const after = Date.now()

		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toMatchObject({
			streamEventType: "session_created",
			sessionId: "sess-xyz",
		})
		const event = result.events[0] as { timestamp: number }
		expect(event.timestamp).toBeGreaterThanOrEqual(before)
		expect(event.timestamp).toBeLessThanOrEqual(after)
	})

	it("should parse session_title_generated event from CLI", () => {
		const result = parseCliChunk(
			'{"event":"session_title_generated","sessionId":"sess-abc-123","title":"My Session Title","timestamp":1234567890}\n',
		)
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toEqual({
			streamEventType: "session_title_generated",
			sessionId: "sess-abc-123",
			title: "My Session Title",
			timestamp: 1234567890,
		})
	})

	it("should use current timestamp when session_title_generated has no timestamp", () => {
		const before = Date.now()
		const result = parseCliChunk(
			'{"event":"session_title_generated","sessionId":"sess-xyz","title":"Test Title"}\n',
		)
		const after = Date.now()

		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toMatchObject({
			streamEventType: "session_title_generated",
			sessionId: "sess-xyz",
			title: "Test Title",
		})
		const event = result.events[0] as { timestamp: number }
		expect(event.timestamp).toBeGreaterThanOrEqual(before)
		expect(event.timestamp).toBeLessThanOrEqual(after)
	})

	it("should parse welcome event with worktree branch and path", () => {
		const result = parseCliChunk(
			'{"type":"welcome","metadata":{"welcomeOptions":{"worktreeBranch":"feature/test-branch","workspace":"/tmp/worktree-path"}},"timestamp":1234567890}\n',
		)
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toEqual({
			streamEventType: "welcome",
			worktreeBranch: "feature/test-branch",
			worktreePath: "/tmp/worktree-path",
			timestamp: 1234567890,
			instructions: undefined,
		})
	})

	it("should parse welcome event without worktree branch", () => {
		const result = parseCliChunk('{"type":"welcome","metadata":{},"timestamp":1234567890}\n')
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toEqual({
			streamEventType: "welcome",
			worktreeBranch: undefined,
			worktreePath: undefined,
			timestamp: 1234567890,
			instructions: undefined,
		})
	})

	it("should parse welcome event with configuration error instructions", () => {
		const result = parseCliChunk(
			'{"type":"welcome","metadata":{"welcomeOptions":{"instructions":["Configuration Error: config.json is incomplete","kilocodeToken is required"]}},"timestamp":1234567890}\n',
		)
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toEqual({
			streamEventType: "welcome",
			worktreeBranch: undefined,
			timestamp: 1234567890,
			instructions: ["Configuration Error: config.json is incomplete", "kilocodeToken is required"],
		})
	})

	it("should not include instructions when array is empty", () => {
		const result = parseCliChunk(
			'{"type":"welcome","metadata":{"welcomeOptions":{"instructions":[]}},"timestamp":1234567890}\n',
		)
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toEqual({
			streamEventType: "welcome",
			worktreeBranch: undefined,
			timestamp: 1234567890,
			instructions: undefined,
		})
	})

	it("should handle welcome event split across chunks", () => {
		// Simulate the exact scenario from production logs where welcome event is split
		const chunk1 = '{"timestamp":1,"source":"cli","type":"welcome","metadata":{"welcomeOptions":{"worktreeBranch":'
		const chunk2 = '"feature/test-branch"}}}\n{"timestamp":2,"source":"extension","type":"say"}\n'

		// First chunk should buffer the partial JSON
		const result1 = parseCliChunk(chunk1)
		expect(result1.events).toHaveLength(0)
		expect(result1.remainingBuffer).toBe(chunk1)

		// Second chunk completes the welcome event and includes another event
		const result2 = parseCliChunk(chunk2, result1.remainingBuffer)
		expect(result2.events).toHaveLength(2)
		expect(result2.events[0]).toMatchObject({
			streamEventType: "welcome",
			worktreeBranch: "feature/test-branch",
		})
		expect(result2.events[1]).toMatchObject({
			streamEventType: "kilocode",
		})
	})

	it("should parse multiple JSON lines", () => {
		const input =
			'{"timestamp":1,"source":"cli","type":"info"}\n{"timestamp":2,"source":"extension","type":"ask"}\n'
		const result = parseCliChunk(input)
		expect(result.events).toHaveLength(2)
		expect(result.events[0]).toMatchObject({ streamEventType: "status" })
		expect(result.events[1]).toMatchObject({
			streamEventType: "kilocode",
			payload: { type: "ask", timestamp: 2 },
		})
	})

	it("should handle partial lines in buffer", () => {
		const result = parseCliChunk('{"timestamp":123')
		expect(result.events).toHaveLength(0)
		expect(result.remainingBuffer).toBe('{"timestamp":123')
	})

	it("should combine buffer with new chunk", () => {
		const result = parseCliChunk(',"source":"extension","type":"say"}\n', '{"timestamp":123')
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toEqual({
			streamEventType: "kilocode",
			payload: {
				timestamp: 123,
				source: "extension",
				type: "say",
			},
		})
	})

	it("should parse JSON with VT control codes", () => {
		const input = '\x1b[2K\x1b[1A\x1b[2K\x1b[G{"timestamp":123,"source":"extension","type":"say"}\n'
		const result = parseCliChunk(input)
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toMatchObject({ streamEventType: "kilocode", payload: { timestamp: 123 } })
	})

	it("should parse concatenated JSON objects on a single line", () => {
		const input =
			'{"type":"welcome","metadata":{"welcomeOptions":{"worktreeBranch":"feature/test","workspace":"/tmp/worktree"}},"timestamp":1}' +
			'{"event":"session_created","sessionId":"sess-1","timestamp":2}\n'
		const result = parseCliChunk(input)
		expect(result.events).toHaveLength(2)
		expect(result.events[0]).toMatchObject({
			streamEventType: "welcome",
			worktreeBranch: "feature/test",
			worktreePath: "/tmp/worktree",
		})
		expect(result.events[1]).toMatchObject({
			streamEventType: "session_created",
			sessionId: "sess-1",
		})
	})

	it("should collect non-JSON lines as output events with VT codes stripped", () => {
		const input = 'not json\n{"timestamp":123,"source":"cli","type":"info"}\nalso not json\n'
		const result = parseCliChunk(input)
		expect(result.events).toHaveLength(3)
		expect(result.events[0]).toMatchObject({ streamEventType: "output", content: "not json" })
		expect(result.events[1]).toMatchObject({ streamEventType: "status" })
		expect(result.events[2]).toMatchObject({ streamEventType: "output", content: "also not json" })
	})

	it("should skip empty lines", () => {
		const input = '\n\n{"timestamp":123,"source":"cli","type":"info"}\n\n'
		const result = parseCliChunk(input)
		expect(result.events).toHaveLength(1)
	})

	it("should handle real CLI output with terminal codes", () => {
		const input =
			'\x1b[2K\x1b[1A\x1b[2K\x1b[G{"timestamp":123,"source":"extension","type":"say","say":"text","content":"Hello"}\n'
		const result = parseCliChunk(input)
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toMatchObject({
			streamEventType: "kilocode",
			payload: { content: "Hello" },
		})
	})
})

describe("CliOutputParser class", () => {
	it("should maintain buffer state across parse calls", () => {
		const parser = new CliOutputParser()

		// First chunk - partial JSON
		const result1 = parser.parse('{"timestamp":123')
		expect(result1.events).toHaveLength(0)

		// Second chunk - completes the JSON
		const result2 = parser.parse(',"source":"extension","type":"say"}\n')
		expect(result2.events).toHaveLength(1)
		expect(result2.events[0]).toMatchObject({
			streamEventType: "kilocode",
			payload: { timestamp: 123 },
		})
	})

	it("should flush remaining buffer", () => {
		const parser = new CliOutputParser()

		parser.parse('{"timestamp":123,"source":"cli","type":"info"}')
		const result = parser.flush()
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toMatchObject({ streamEventType: "status" })
	})

	it("should reset buffer state", () => {
		const parser = new CliOutputParser()

		parser.parse('{"timestamp":123')
		parser.reset()

		// This should not combine with previous partial
		const result = parser.parse(',"source":"extension"}\n')
		expect(result.events).toHaveLength(1)
		expect(result.events[0]).toMatchObject({ streamEventType: "output" })
	})

	it("should handle streaming chunks correctly", () => {
		const parser = new CliOutputParser()
		const events: StreamEvent[] = []

		// Simulate streaming output
		const chunks = [
			'{"timestamp":1,"source":"extension","type":"say","partial":true,"content":"He',
			'llo"}\n{"timestamp":2,"source":"extension","type":"say","partial":false,"content":"Hello World"}\n',
			'{"timestamp":3,"source":"cli","type":"info"}',
		]

		for (const chunk of chunks) {
			const result = parser.parse(chunk)
			events.push(...result.events)
		}

		// Flush remaining (last chunk had no newline)
		const final = parser.flush()
		events.push(...final.events)

		expect(events).toHaveLength(3)
		expect(events[0]).toMatchObject({ streamEventType: "kilocode", payload: { content: "Hello" } })
		expect(events[1]).toMatchObject({ streamEventType: "kilocode", payload: { content: "Hello World" } })
		expect(events[2]).toMatchObject({ streamEventType: "status" })
	})

	it("should flush concatenated JSON objects", () => {
		const parser = new CliOutputParser()
		parser.parse(
			'{"type":"welcome","metadata":{"welcomeOptions":{"worktreeBranch":"feature/test","workspace":"/tmp/worktree"}},"timestamp":1}' +
				'{"event":"session_created","sessionId":"sess-1","timestamp":2}',
		)
		const result = parser.flush()
		expect(result.events).toHaveLength(2)
		expect(result.events[0]).toMatchObject({
			streamEventType: "welcome",
			worktreeBranch: "feature/test",
			worktreePath: "/tmp/worktree",
		})
		expect(result.events[1]).toMatchObject({
			streamEventType: "session_created",
			sessionId: "sess-1",
		})
	})
})
