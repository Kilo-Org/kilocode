import { describe, it, expect } from "vitest"
import { filterErrorMessages } from "../filterErrorMessages"
import type { ClineMessage } from "@roo-code/types"

describe("filterErrorMessages", () => {
	const mockMessages: ClineMessage[] = [
		{
			type: "say",
			say: "text",
			text: "Normal message",
			ts: 1000,
		},
		{
			type: "say",
			say: "error",
			text: "This is an error message",
			ts: 1001,
		},
		{
			type: "say",
			say: "api_req_started",
			text: '{"request":"GET /api/data","error":"API failed"}',
			ts: 1002,
		},
		{
			type: "say",
			say: "api_req_started",
			text: '{"request":"POST /api/data","status":"success"}',
			ts: 1003,
		},
		{
			type: "say",
			say: "reasoning",
			text: "Thinking about the problem",
			ts: 1004,
		},
	]

	it("should return all messages when excludeErrorMessages is false", () => {
		const result = filterErrorMessages(mockMessages, false)
		expect(result).toEqual(mockMessages)
		expect(result.length).toBe(5)
	})

	it("should return all messages when excludeErrorMessages is not provided (default false)", () => {
		const result = filterErrorMessages(mockMessages)
		expect(result).toEqual(mockMessages)
		expect(result.length).toBe(5)
	})

	it("should filter out error messages when excludeErrorMessages is true", () => {
		const result = filterErrorMessages(mockMessages, true)

		// Should exclude: error message and api_req_started with error
		expect(result.length).toBe(3)

		// Should keep: normal text, successful api_req_started, and reasoning
		expect(result[0].say).toBe("text")
		expect(result[1].say).toBe("api_req_started")
		expect(JSON.parse(result[1].text!).status).toBe("success")
		expect(result[2].say).toBe("reasoning")
	})

	it("should handle api_req_started messages with invalid JSON gracefully", () => {
		const messagesWithInvalidJson: ClineMessage[] = [
			{
				type: "say",
				say: "api_req_started",
				text: "invalid json",
				ts: 1000,
			},
			{
				type: "say",
				say: "text",
				text: "Normal message",
				ts: 1001,
			},
		]

		const result = filterErrorMessages(messagesWithInvalidJson, true)

		// Should keep both messages since invalid JSON is not considered an error
		expect(result.length).toBe(2)
	})

	it("should filter out messages with errorMessage field", () => {
		const messagesWithErrorMessage: ClineMessage[] = [
			{
				type: "say",
				say: "api_req_started",
				text: '{"request":"GET /api/data","errorMessage":"Something went wrong"}',
				ts: 1000,
			},
		]

		const result = filterErrorMessages(messagesWithErrorMessage, true)
		expect(result.length).toBe(0)
	})

	it("should filter out messages with status error", () => {
		const messagesWithStatusError: ClineMessage[] = [
			{
				type: "say",
				say: "api_req_started",
				text: '{"request":"GET /api/data","status":"error"}',
				ts: 1000,
			},
		]

		const result = filterErrorMessages(messagesWithStatusError, true)
		expect(result.length).toBe(0)
	})
})
