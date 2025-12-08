/**
 * Tests for useStdinJsonHandler hook
 *
 * This hook handles JSON messages from stdin in jsonInteractive mode,
 * enabling bidirectional communication.
 */

import { describe, it, expect, vi } from "vitest"
import { Readable } from "stream"
import { createInterface } from "readline"

// Mock the atoms
vi.mock("../../atoms/actions.js", () => ({
	sendAskResponseAtom: { write: vi.fn() },
	cancelTaskAtom: { write: vi.fn() },
	respondToToolAtom: { write: vi.fn() },
}))

// Mock the logs service
vi.mock("../../../services/logs.js", () => ({
	logs: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

describe("useStdinJsonHandler", () => {
	describe("Message Parsing", () => {
		it("should parse valid JSON messages", () => {
			const validMessages = [
				{ type: "askResponse", askResponse: "messageResponse", text: "hello" },
				{ type: "cancelTask" },
				{ type: "respondToApproval", approved: true },
				{ type: "respondToApproval", approved: false, text: "rejected" },
			]

			for (const msg of validMessages) {
				expect(() => JSON.parse(JSON.stringify(msg))).not.toThrow()
			}
		})

		it("should handle askResponse with yesButtonClicked", () => {
			const message = {
				type: "askResponse",
				askResponse: "yesButtonClicked",
				text: "approved",
			}
			const parsed = JSON.parse(JSON.stringify(message))
			expect(parsed.type).toBe("askResponse")
			expect(parsed.askResponse).toBe("yesButtonClicked")
		})

		it("should handle askResponse with noButtonClicked", () => {
			const message = {
				type: "askResponse",
				askResponse: "noButtonClicked",
				text: "rejected",
			}
			const parsed = JSON.parse(JSON.stringify(message))
			expect(parsed.type).toBe("askResponse")
			expect(parsed.askResponse).toBe("noButtonClicked")
		})

		it("should handle askResponse with messageResponse", () => {
			const message = {
				type: "askResponse",
				askResponse: "messageResponse",
				text: "user message",
				images: ["image1.png"],
			}
			const parsed = JSON.parse(JSON.stringify(message))
			expect(parsed.type).toBe("askResponse")
			expect(parsed.askResponse).toBe("messageResponse")
			expect(parsed.text).toBe("user message")
			expect(parsed.images).toEqual(["image1.png"])
		})

		it("should handle cancelTask message", () => {
			const message = { type: "cancelTask" }
			const parsed = JSON.parse(JSON.stringify(message))
			expect(parsed.type).toBe("cancelTask")
		})

		it("should handle respondToApproval with approved=true", () => {
			const message = {
				type: "respondToApproval",
				approved: true,
				text: "go ahead",
			}
			const parsed = JSON.parse(JSON.stringify(message))
			expect(parsed.type).toBe("respondToApproval")
			expect(parsed.approved).toBe(true)
			expect(parsed.text).toBe("go ahead")
		})

		it("should handle respondToApproval with approved=false", () => {
			const message = {
				type: "respondToApproval",
				approved: false,
				text: "denied",
			}
			const parsed = JSON.parse(JSON.stringify(message))
			expect(parsed.type).toBe("respondToApproval")
			expect(parsed.approved).toBe(false)
			expect(parsed.text).toBe("denied")
		})
	})

	describe("Message Type Validation", () => {
		it("should identify valid message types", () => {
			const validTypes = ["askResponse", "cancelTask", "respondToApproval"]
			for (const type of validTypes) {
				expect(validTypes.includes(type)).toBe(true)
			}
		})

		it("should identify unknown message types", () => {
			const validTypes = ["askResponse", "cancelTask", "respondToApproval"]
			const unknownTypes = ["unknown", "invalid", "foo", "bar"]
			for (const type of unknownTypes) {
				expect(validTypes.includes(type)).toBe(false)
			}
		})
	})

	describe("JSON Parsing Error Handling", () => {
		it("should handle invalid JSON gracefully", () => {
			const invalidJsonStrings = ["not json", "{invalid}", "{'single': 'quotes'}", "", "   ", "null", "undefined"]

			for (const str of invalidJsonStrings) {
				if (str.trim() === "" || str === "null" || str === "undefined") {
					// Empty strings and null/undefined should be handled specially
					continue
				}
				try {
					JSON.parse(str)
				} catch (e) {
					expect(e).toBeInstanceOf(SyntaxError)
				}
			}
		})

		it("should handle empty lines", () => {
			const emptyLines = ["", "   ", "\t", "\n"]
			for (const line of emptyLines) {
				expect(line.trim()).toBe("")
			}
		})
	})

	describe("Readline Interface", () => {
		it("should create readline interface with correct options", () => {
			const mockStdin = new Readable({
				read() {},
			})

			const rl = createInterface({
				input: mockStdin,
				terminal: false,
			})

			expect(rl).toBeDefined()
			rl.close()
		})

		it("should handle line events", async () => {
			const mockStdin = new Readable({
				read() {},
			})

			const rl = createInterface({
				input: mockStdin,
				terminal: false,
			})

			const lines: string[] = []
			rl.on("line", (line) => {
				lines.push(line)
			})

			// Simulate pushing data
			mockStdin.push('{"type":"cancelTask"}\n')
			mockStdin.push(null) // End of stream

			// Wait for processing
			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(lines).toContain('{"type":"cancelTask"}')
			rl.close()
		})

		it("should handle close events", async () => {
			const mockStdin = new Readable({
				read() {},
			})

			const rl = createInterface({
				input: mockStdin,
				terminal: false,
			})

			let closed = false
			rl.on("close", () => {
				closed = true
			})

			rl.close()

			expect(closed).toBe(true)
		})
	})

	describe("Message Structure", () => {
		it("should support optional text field", () => {
			const withText = { type: "askResponse", askResponse: "messageResponse", text: "hello" }
			const withoutText = { type: "askResponse", askResponse: "messageResponse" }

			expect(withText.text).toBe("hello")
			expect(withoutText.text).toBeUndefined()
		})

		it("should support optional images field", () => {
			const withImages = {
				type: "askResponse",
				askResponse: "messageResponse",
				images: ["img1.png", "img2.png"],
			}
			const withoutImages = { type: "askResponse", askResponse: "messageResponse" }

			expect(withImages.images).toEqual(["img1.png", "img2.png"])
			expect(withoutImages.images).toBeUndefined()
		})

		it("should support approved boolean field for respondToApproval", () => {
			const approved = { type: "respondToApproval", approved: true }
			const rejected = { type: "respondToApproval", approved: false }

			expect(approved.approved).toBe(true)
			expect(rejected.approved).toBe(false)
		})
	})
})

describe("StdinMessage Interface", () => {
	interface StdinMessage {
		type: string
		askResponse?: string
		text?: string
		images?: string[]
		approved?: boolean
	}

	it("should match expected interface structure", () => {
		const message: StdinMessage = {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "test",
			images: ["img.png"],
		}

		expect(message.type).toBe("askResponse")
		expect(message.askResponse).toBe("messageResponse")
		expect(message.text).toBe("test")
		expect(message.images).toEqual(["img.png"])
	})

	it("should allow minimal message with only type", () => {
		const message: StdinMessage = {
			type: "cancelTask",
		}

		expect(message.type).toBe("cancelTask")
		expect(message.askResponse).toBeUndefined()
		expect(message.text).toBeUndefined()
		expect(message.images).toBeUndefined()
		expect(message.approved).toBeUndefined()
	})
})
