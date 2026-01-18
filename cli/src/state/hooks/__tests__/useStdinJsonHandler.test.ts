/**
 * Tests for useStdinJsonHandler hook
 *
 * Tests the handleStdinMessage function which handles JSON messages
 * from stdin in jsonInteractive mode.
 *
 * Supports both:
 * - Schema v1.0.0 (versioned format)
 * - Legacy format (backward compatibility)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { JSON_SCHEMA_VERSION } from "@kilocode/core-schemas"
import {
	handleStdinMessage,
	handleVersionedMessage,
	type StdinMessage,
	type StdinMessageHandlers,
} from "../useStdinJsonHandler.js"

describe("handleStdinMessage", () => {
	let handlers: StdinMessageHandlers
	let sendAskResponse: ReturnType<typeof vi.fn>
	let cancelTask: ReturnType<typeof vi.fn>
	let respondToTool: ReturnType<typeof vi.fn>

	beforeEach(() => {
		sendAskResponse = vi.fn().mockResolvedValue(undefined)
		cancelTask = vi.fn().mockResolvedValue(undefined)
		respondToTool = vi.fn().mockResolvedValue(undefined)

		handlers = {
			sendAskResponse,
			cancelTask,
			respondToTool,
		}
	})

	describe("askResponse messages", () => {
		it("should call sendAskResponse for messageResponse", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "messageResponse",
				text: "hello world",
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
				text: "hello world",
			})
			expect(respondToTool).not.toHaveBeenCalled()
		})

		it("should call sendAskResponse with images when provided", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "messageResponse",
				text: "check this",
				images: ["img1.png", "img2.png"],
			}

			await handleStdinMessage(message, handlers)

			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
				text: "check this",
				images: ["img1.png", "img2.png"],
			})
		})

		it("should default to messageResponse when askResponse is undefined", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				text: "hello",
			}

			await handleStdinMessage(message, handlers)

			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
				text: "hello",
			})
		})

		it("should call respondToTool for yesButtonClicked", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "yesButtonClicked",
				text: "approved",
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
				text: "approved",
			})
			expect(sendAskResponse).not.toHaveBeenCalled()
		})

		it("should call respondToTool for noButtonClicked", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "noButtonClicked",
				text: "rejected",
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(respondToTool).toHaveBeenCalledWith({
				response: "noButtonClicked",
				text: "rejected",
			})
		})

		it("should include images for yesButtonClicked", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "yesButtonClicked",
				images: ["screenshot.png"],
			}

			await handleStdinMessage(message, handlers)

			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
				images: ["screenshot.png"],
			})
		})
	})

	describe("cancelTask messages", () => {
		it("should call cancelTask handler", async () => {
			const message: StdinMessage = {
				type: "cancelTask",
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(cancelTask).toHaveBeenCalled()
			expect(sendAskResponse).not.toHaveBeenCalled()
			expect(respondToTool).not.toHaveBeenCalled()
		})
	})

	describe("respondToApproval messages", () => {
		it("should call respondToTool with yesButtonClicked when approved is true", async () => {
			const message: StdinMessage = {
				type: "respondToApproval",
				approved: true,
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
			})
		})

		it("should call respondToTool with noButtonClicked when approved is false", async () => {
			const message: StdinMessage = {
				type: "respondToApproval",
				approved: false,
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(respondToTool).toHaveBeenCalledWith({
				response: "noButtonClicked",
			})
		})

		it("should include text when provided with approval", async () => {
			const message: StdinMessage = {
				type: "respondToApproval",
				approved: true,
				text: "go ahead",
			}

			await handleStdinMessage(message, handlers)

			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
				text: "go ahead",
			})
		})

		it("should include text when rejecting", async () => {
			const message: StdinMessage = {
				type: "respondToApproval",
				approved: false,
				text: "not allowed",
			}

			await handleStdinMessage(message, handlers)

			expect(respondToTool).toHaveBeenCalledWith({
				response: "noButtonClicked",
				text: "not allowed",
			})
		})
	})

	describe("unknown message types", () => {
		it("should return handled: false for unknown types", async () => {
			const message: StdinMessage = {
				type: "unknownType",
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(false)
			expect(result.error).toBe("Unknown message type: unknownType")
			expect(sendAskResponse).not.toHaveBeenCalled()
			expect(cancelTask).not.toHaveBeenCalled()
			expect(respondToTool).not.toHaveBeenCalled()
		})
	})

	describe("optional fields", () => {
		it("should not include text when undefined", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "messageResponse",
			}

			await handleStdinMessage(message, handlers)

			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
			})
			// Verify text is not in the call
			const call = sendAskResponse.mock.calls[0][0]
			expect("text" in call).toBe(false)
		})

		it("should not include images when undefined", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "messageResponse",
				text: "hello",
			}

			await handleStdinMessage(message, handlers)

			const call = sendAskResponse.mock.calls[0][0]
			expect("images" in call).toBe(false)
		})
	})
})

describe("handleVersionedMessage (schema v1.0.0)", () => {
	let handlers: StdinMessageHandlers
	let sendAskResponse: ReturnType<typeof vi.fn>
	let cancelTask: ReturnType<typeof vi.fn>
	let respondToTool: ReturnType<typeof vi.fn>

	beforeEach(() => {
		sendAskResponse = vi.fn().mockResolvedValue(undefined)
		cancelTask = vi.fn().mockResolvedValue(undefined)
		respondToTool = vi.fn().mockResolvedValue(undefined)

		handlers = {
			sendAskResponse,
			cancelTask,
			respondToTool,
		}
	})

	describe("user_input messages", () => {
		it("should call sendAskResponse for user_input", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "user_input",
				content: "hello world",
			}

			const result = await handleVersionedMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
				text: "hello world",
			})
		})

		it("should handle user_input without content", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "user_input",
			}

			const result = await handleVersionedMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
			})
		})

		it("should pass images in user_input", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "user_input",
				content: "check this",
				images: ["screenshot.png"],
			}

			const result = await handleVersionedMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
				text: "check this",
				images: ["screenshot.png"],
			})
		})
	})

	describe("approval messages", () => {
		it("should call respondToTool with yesButtonClicked for approval", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "approval",
			}

			const result = await handleVersionedMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
			})
		})

		it("should include content text when approving", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "approval",
				content: "approved with comment",
			}

			await handleVersionedMessage(message, handlers)

			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
				text: "approved with comment",
			})
		})

		it("should pass images in approval", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "approval",
				images: ["screenshot.png"],
			}

			await handleVersionedMessage(message, handlers)

			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
				images: ["screenshot.png"],
			})
		})
	})

	describe("rejection messages", () => {
		it("should call respondToTool with noButtonClicked for rejection", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "rejection",
			}

			const result = await handleVersionedMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(respondToTool).toHaveBeenCalledWith({
				response: "noButtonClicked",
			})
		})

		it("should include rejection reason as text", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "rejection",
				content: "not allowed for security reasons",
			}

			await handleVersionedMessage(message, handlers)

			expect(respondToTool).toHaveBeenCalledWith({
				response: "noButtonClicked",
				text: "not allowed for security reasons",
			})
		})

		it("should pass images in rejection", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "rejection",
				content: "rejected",
				images: ["evidence.png"],
			}

			await handleVersionedMessage(message, handlers)

			expect(respondToTool).toHaveBeenCalledWith({
				response: "noButtonClicked",
				text: "rejected",
				images: ["evidence.png"],
			})
		})
	})

	describe("abort messages", () => {
		it("should call cancelTask for abort", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "abort",
			}

			const result = await handleVersionedMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(cancelTask).toHaveBeenCalled()
			expect(sendAskResponse).not.toHaveBeenCalled()
			expect(respondToTool).not.toHaveBeenCalled()
		})
	})

	describe("response messages", () => {
		it("should call sendAskResponse with retry_clicked", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "response",
				response: "retry_clicked",
			}

			const result = await handleVersionedMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "retry_clicked",
			})
		})

		it("should call sendAskResponse with objectResponse", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "response",
				response: "objectResponse",
				content: JSON.stringify({ choice: "file1.ts" }),
			}

			const result = await handleVersionedMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "objectResponse",
				text: JSON.stringify({ choice: "file1.ts" }),
			})
		})

		it("should call sendAskResponse with messageResponse via response type", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "response",
				response: "messageResponse",
				content: "hello",
			}

			const result = await handleVersionedMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
				text: "hello",
			})
		})
	})

	describe("unknown message types", () => {
		it("should return handled: false for unknown types", async () => {
			const message = {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "unknownType",
			}

			const result = await handleVersionedMessage(message, handlers)

			expect(result.handled).toBe(false)
			expect(result.error).toBe("Unknown versioned message type: unknownType")
		})
	})
})
