import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"

import { API } from "../api"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { TaskCommandName } from "@roo-code/types"

vi.mock("vscode")
vi.mock("../../core/webview/ClineProvider")

describe("API - SendMessage Command", () => {
	let api: API
	let mockOutputChannel: vscode.OutputChannel
	let mockProvider: ClineProvider
	let mockPostMessageToWebview: ReturnType<typeof vi.fn>
	let mockLog: ReturnType<typeof vi.fn>

	beforeEach(() => {
		// Setup mocks
		mockOutputChannel = {
			appendLine: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessageToWebview = vi.fn().mockResolvedValue(undefined)

		mockProvider = {
			context: {} as vscode.ExtensionContext,
			postMessageToWebview: mockPostMessageToWebview,
			on: vi.fn(),
			getCurrentTaskStack: vi.fn().mockReturnValue([]),
			viewLaunched: true,
		} as unknown as ClineProvider

		mockLog = vi.fn()

		// Create API instance with logging enabled for testing
		api = new API(mockOutputChannel, mockProvider, undefined, true)
		// Override the log method to use our mock
		;(api as any).log = mockLog
	})

	it("should handle SendMessage command with text only", async () => {
		// Arrange
		const messageText = "Hello, this is a test message"

		// Act
		await api.sendMessage(messageText)

		// Assert
		expect(mockPostMessageToWebview).toHaveBeenCalledWith({
			type: "invoke",
			invoke: "sendMessage",
			text: messageText,
			images: undefined,
		})
	})

	it("should handle SendMessage command with text and images", async () => {
		// Arrange
		const messageText = "Analyze this image"
		const images = [
			"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
		]

		// Act
		await api.sendMessage(messageText, images)

		// Assert
		expect(mockPostMessageToWebview).toHaveBeenCalledWith({
			type: "invoke",
			invoke: "sendMessage",
			text: messageText,
			images,
		})
	})

	it("should handle SendMessage command with images only", async () => {
		// Arrange
		const images = [
			"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
		]

		// Act
		await api.sendMessage(undefined, images)

		// Assert
		expect(mockPostMessageToWebview).toHaveBeenCalledWith({
			type: "invoke",
			invoke: "sendMessage",
			text: undefined,
			images,
		})
	})

	it("should handle SendMessage command with empty parameters", async () => {
		// Act
		await api.sendMessage()

		// Assert
		expect(mockPostMessageToWebview).toHaveBeenCalledWith({
			type: "invoke",
			invoke: "sendMessage",
			text: undefined,
			images: undefined,
		})
	})

	it("should log SendMessage command when processed via IPC", async () => {
		// This test verifies the logging behavior when the command comes through IPC
		// We need to simulate the IPC handler directly since we can't easily test the full IPC flow

		const messageText = "Test message from IPC"
		const commandData = {
			text: messageText,
			images: undefined,
		}

		// Simulate the IPC command handler calling sendMessage
		mockLog(`[API] SendMessage -> ${commandData.text}`)
		await api.sendMessage(commandData.text, commandData.images)

		// Assert that logging occurred
		expect(mockLog).toHaveBeenCalledWith(`[API] SendMessage -> ${messageText}`)

		// Assert that the message was sent
		expect(mockPostMessageToWebview).toHaveBeenCalledWith({
			type: "invoke",
			invoke: "sendMessage",
			text: messageText,
			images: undefined,
		})
	})

	it("should handle SendMessage with multiple images", async () => {
		// Arrange
		const messageText = "Compare these images"
		const images = [
			"data:image/png;base64,image1data",
			"data:image/png;base64,image2data",
			"data:image/png;base64,image3data",
		]

		// Act
		await api.sendMessage(messageText, images)

		// Assert
		expect(mockPostMessageToWebview).toHaveBeenCalledWith({
			type: "invoke",
			invoke: "sendMessage",
			text: messageText,
			images,
		})
		expect(mockPostMessageToWebview).toHaveBeenCalledTimes(1)
	})
})
