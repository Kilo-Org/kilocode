// kilocode_change - new file
import { type Page } from "@playwright/test"
import { verifyExtensionInstalled, waitForWebviewText, configureApiKeyThroughUI } from "./webview-helpers"

export async function setupTestEnvironment(page: Page): Promise<void> {
	await verifyExtensionInstalled(page)
	await waitForWebviewText(page, "Welcome to Kilo Code!")
	await configureApiKeyThroughUI(page)
	await waitForWebviewText(page, "Generate, refactor, and debug code with AI assistance")
}
