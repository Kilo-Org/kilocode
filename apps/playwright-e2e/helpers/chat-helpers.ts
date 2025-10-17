// kilocode_change - new file
import { type Page } from "@playwright/test"
import { findWebview } from "./webview-helpers"

export async function getChatInput(page: Page) {
	const webviewFrame = await findWebview(page)
	const chatInput = webviewFrame.locator('textarea, input[type="text"]').first()
	await chatInput.waitFor()
	return chatInput
}

export async function sendMessage(page: Page, message: string): Promise<void> {
	const chatInput = await getChatInput(page)
	await chatInput.fill(message)
	await chatInput.press("Enter")
}
