/**
 * Tests for useStdinJsonHandler hook
 *
 * Tests the handleStdinMessage function which handles JSON messages
 * from stdin in jsonInteractive mode.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { handleStdinMessage, type StdinMessage, type StdinMessageHandlers } from "../useStdinJsonHandler.js"

// Mock the image-utils module which is used by useStdinJsonHandler
vi.mock("../../../media/image-utils.js", () => ({
	convertImagesToDataUrls: vi.fn().mockImplementation(async (images: string[] | undefined) => {
		if (!images || images.length === 0) return { images: [], errors: [] }
		const convertedImages = images.map((img) =>
			img.startsWith("data:") ? img : `data:image/png;base64,mock-${img.replace(/[^a-zA-Z0-9]/g, "")}`,
		)
		return { images: convertedImages, errors: [] }
	}),
}))

describe("handleStdinMessage", () => {
	let handlers: StdinMessageHandlers
	let sendAskResponse: ReturnType<typeof vi.fn>
	let sendTask: ReturnType<typeof vi.fn>
	let cancelTask: ReturnType<typeof vi.fn>
	let respondToTool: ReturnType<typeof vi.fn>

	beforeEach(() => {
		sendAskResponse = vi.fn().mockResolvedValue(undefined)
		sendTask = vi.fn().mockResolvedValue(undefined)
		cancelTask = vi.fn().mockResolvedValue(undefined)
		respondToTool = vi.fn().mockResolvedValue(undefined)

		handlers = {
			sendAskResponse,
			sendTask,
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

		it("should call sendAskResponse with images converted to data URLs when file paths provided", async () => {
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
				images: ["data:image/png;base64,mock-img1png", "data:image/png;base64,mock-img2png"],
			})
		})

		it("should pass through data URLs unchanged", async () => {
			const dataUrl =
				"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "messageResponse",
				text: "check this",
				images: [dataUrl],
			}

			await handleStdinMessage(message, handlers)

			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
				text: "check this",
				images: [dataUrl],
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

		it("should include images converted to data URLs for yesButtonClicked", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "yesButtonClicked",
				images: ["screenshot.png"],
			}

			await handleStdinMessage(message, handlers)

			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
				images: ["data:image/png;base64,mock-screenshotpng"],
			})
		})
	})

	describe("newTask messages", () => {
		it("should call sendTask with text", async () => {
			const message: StdinMessage = {
				type: "newTask",
				text: "Start a new task",
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(sendTask).toHaveBeenCalledWith({
				text: "Start a new task",
			})
		})

		it("should call sendTask with images converted to data URLs", async () => {
			const message: StdinMessage = {
				type: "newTask",
				text: "Check this image",
				images: ["/tmp/screenshot.png"],
			}

			await handleStdinMessage(message, handlers)

			expect(sendTask).toHaveBeenCalledWith({
				text: "Check this image",
				images: ["data:image/png;base64,mock-tmpscreenshotpng"],
			})
		})

		it("should pass through data URLs unchanged in newTask", async () => {
			const dataUrl =
				"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
			const message: StdinMessage = {
				type: "newTask",
				text: "Check this",
				images: [dataUrl],
			}

			await handleStdinMessage(message, handlers)

			expect(sendTask).toHaveBeenCalledWith({
				text: "Check this",
				images: [dataUrl],
			})
		})

		it("should default to empty text when text is undefined", async () => {
			const message: StdinMessage = {
				type: "newTask",
			}

			await handleStdinMessage(message, handlers)

			expect(sendTask).toHaveBeenCalledWith({
				text: "",
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
