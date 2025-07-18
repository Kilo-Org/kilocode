import { type Page, type FrameLocator, expect } from "@playwright/test"
import { findWebview } from "./webview-helpers"

export async function getChatInput(page: Page) {
	const webviewFrame = await findWebview(page)
	const chatInput = webviewFrame.locator('textarea, input[type="text"]').first()
	await chatInput.waitFor({ timeout: 10000 })
	return chatInput
}

export async function typeMessage(page: Page, message: string): Promise<void> {
	const chatInput = await getChatInput(page)
	await chatInput.fill(message)
}

export async function sendMessage(page: Page, message: string): Promise<void> {
	const chatInput = await getChatInput(page)
	await chatInput.fill(message)
	await chatInput.press("Enter")
}

export async function getChatInputValue(page: Page): Promise<string> {
	const chatInput = await getChatInput(page)
	return await chatInput.inputValue()
}

export async function clearChatInput(page: Page): Promise<void> {
	const chatInput = await getChatInput(page)
	await chatInput.fill("")
}
