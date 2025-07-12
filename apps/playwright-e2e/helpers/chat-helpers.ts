import { type Page, type FrameLocator, expect } from "@playwright/test"
import { findWebview } from "./webview-helpers"

/**
 * Gets the chat input element from the webview
 */
export async function getChatInput(page: Page) {
	const webviewFrame = await findWebview(page)
	const chatInput = webviewFrame.locator('textarea, input[type="text"]').first()
	await chatInput.waitFor({ timeout: 10000 })
	return chatInput
}

/**
 * Types a message into the chat input
 */
export async function typeMessage(page: Page, message: string): Promise<void> {
	const chatInput = await getChatInput(page)
	await chatInput.fill(message)
}

/**
 * Sends a message by typing it and pressing Enter
 */
export async function sendMessage(page: Page, message: string): Promise<void> {
	const chatInput = await getChatInput(page)
	await chatInput.fill(message)
	await chatInput.press("Enter")
}

/**
 * Gets the current value of the chat input
 */
export async function getChatInputValue(page: Page): Promise<string> {
	const chatInput = await getChatInput(page)
	return await chatInput.inputValue()
}

/**
 * Clears the chat input
 */
export async function clearChatInput(page: Page): Promise<void> {
	const chatInput = await getChatInput(page)
	await chatInput.fill("")
}
