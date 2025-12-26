import { describe, it, expect } from "vitest"
import { extractPayloadMessage, extractApiReqFailedMessage } from "../askErrorParser"
import type { KilocodePayload } from "../CliOutputParser"

describe("askErrorParser", () => {
	describe("extractPayloadMessage", () => {
		const defaultMessage = "Default fallback message"

		it("returns text field when present", () => {
			const payload: KilocodePayload = { text: "Error from text field" }
			expect(extractPayloadMessage(payload, defaultMessage)).toBe("Error from text field")
		})

		it("returns content field when text is not present", () => {
			const payload: KilocodePayload = { content: "Error from content field" }
			expect(extractPayloadMessage(payload, defaultMessage)).toBe("Error from content field")
		})

		it("prefers text over content when both present", () => {
			const payload: KilocodePayload = { text: "From text", content: "From content" }
			expect(extractPayloadMessage(payload, defaultMessage)).toBe("From text")
		})

		it("returns default message when payload is empty", () => {
			const payload: KilocodePayload = {}
			expect(extractPayloadMessage(payload, defaultMessage)).toBe(defaultMessage)
		})

		it("returns default message when text/content are not strings", () => {
			const payload = { text: 123, content: null } as unknown as KilocodePayload
			expect(extractPayloadMessage(payload, defaultMessage)).toBe(defaultMessage)
		})

		it("extracts message field from JSON object", () => {
			const payload: KilocodePayload = { text: '{"message": "Need billing"}' }
			expect(extractPayloadMessage(payload, defaultMessage)).toBe("Need billing")
		})

		it("falls back to raw text when JSON has no message field", () => {
			const payload: KilocodePayload = { text: '{"error": "some error"}' }
			expect(extractPayloadMessage(payload, defaultMessage)).toBe('{"error": "some error"}')
		})

		it("falls back to raw text for JSON array", () => {
			const payload: KilocodePayload = { text: '["error1", "error2"]' }
			expect(extractPayloadMessage(payload, defaultMessage)).toBe('["error1", "error2"]')
		})

		it("falls back to raw text for malformed JSON", () => {
			const payload: KilocodePayload = { text: '{"message": malformed}' }
			expect(extractPayloadMessage(payload, defaultMessage)).toBe('{"message": malformed}')
		})

		it("returns text when it contains plain error message", () => {
			const payload: KilocodePayload = { text: "Connection timeout" }
			expect(extractPayloadMessage(payload, defaultMessage)).toBe("Connection timeout")
		})

		it("handles whitespace-only text", () => {
			const payload: KilocodePayload = { text: "   " }
			// Note: Current implementation returns whitespace as-is
			// Future improvement: could trim and return default
			expect(extractPayloadMessage(payload, defaultMessage)).toBe("   ")
		})
	})

	describe("extractApiReqFailedMessage", () => {
		it("extracts plain text message", () => {
			const payload: KilocodePayload = { text: "Auth failed" }
			const result = extractApiReqFailedMessage(payload)
			expect(result.message).toBe("Auth failed")
			expect(result.authError).toBe(false)
		})

		it("extracts message from content field", () => {
			const payload: KilocodePayload = { content: "Request timeout" }
			const result = extractApiReqFailedMessage(payload)
			expect(result.message).toBe("Request timeout")
			expect(result.authError).toBe(false)
		})

		it("detects 401 status code and marks as auth error", () => {
			const payload: KilocodePayload = {
				content: '401 {"type":"error","error":{"type":"authentication_error"}}',
			}
			const result = extractApiReqFailedMessage(payload)
			expect(result.authError).toBe(true)
			expect(result.message).toMatch(/^Authentication failed:/)
		})

		it("detects 401 status code even when not at start of message", () => {
			const payload: KilocodePayload = { text: "Provider error: 401 No cookie auth credentials found" }
			const result = extractApiReqFailedMessage(payload)
			expect(result.authError).toBe(true)
			expect(result.message).toBe("Authentication failed: Provider error: 401 No cookie auth credentials found")
		})

		it("does not treat unrelated 3-digit numbers as status codes", () => {
			const payload: KilocodePayload = { text: "Error processing 123 items" }
			const result = extractApiReqFailedMessage(payload)
			expect(result.authError).toBe(false)
			expect(result.message).toBe("Error processing 123 items")
		})

		it("does not mark non-401 status codes as auth error", () => {
			const payload: KilocodePayload = { text: "500 Internal Server Error" }
			const result = extractApiReqFailedMessage(payload)
			expect(result.authError).toBe(false)
			expect(result.message).toBe("500 Internal Server Error")
		})

		it("returns fallback message when payload has JSON content", () => {
			const payload: KilocodePayload = {
				text: '{"type":"error","message":"something went wrong"}',
			}
			const result = extractApiReqFailedMessage(payload)
			expect(result.message).toBe("API request failed.")
			expect(result.authError).toBe(false)
		})

		it("returns fallback message when payload is empty", () => {
			const payload: KilocodePayload = {}
			const result = extractApiReqFailedMessage(payload)
			expect(result.message).toBe("API request failed.")
			expect(result.authError).toBe(false)
		})

		it("handles 401 with JSON body by prefixing Authentication failed", () => {
			const payload: KilocodePayload = {
				content: '401 {"error":"invalid_token"}',
			}
			const result = extractApiReqFailedMessage(payload)
			expect(result.authError).toBe(true)
			expect(result.message).toBe("Authentication failed: API request failed.")
		})

		it("does not double-prefix when message already starts with Authentication failed", () => {
			const payload: KilocodePayload = {
				text: "Authentication failed: invalid token",
			}
			const result = extractApiReqFailedMessage(payload)
			// No status code means authError is false
			expect(result.authError).toBe(false)
			// Message is passed through as-is (no 401 prefix to trigger auth prefix)
			expect(result.message).toBe("Authentication failed: invalid token")
		})

		it("prepends Authentication failed for 401 without existing prefix", () => {
			const payload: KilocodePayload = {
				text: "401 Unauthorized access",
			}
			const result = extractApiReqFailedMessage(payload)
			expect(result.authError).toBe(true)
			expect(result.message).toBe("Authentication failed: 401 Unauthorized access")
		})

		it("handles whitespace before status code", () => {
			const payload: KilocodePayload = { text: "  401 Unauthorized" }
			const result = extractApiReqFailedMessage(payload)
			expect(result.authError).toBe(true)
		})

		it("handles 403 status code as non-auth error", () => {
			const payload: KilocodePayload = { text: "403 Forbidden" }
			const result = extractApiReqFailedMessage(payload)
			expect(result.authError).toBe(false)
			expect(result.message).toBe("403 Forbidden")
		})
	})
})
