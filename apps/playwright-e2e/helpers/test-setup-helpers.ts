import { type Page } from "@playwright/test"
import { verifyExtensionInstalled, waitForWebviewText, configureApiKeyThroughUI } from "./webview-helpers"

/**
 * Performs the standard test setup sequence that every test needs:
 * 1. Verify extension is installed
 * 2. Wait for welcome message
 * 3. Configure API key through UI
 * 4. Wait for ready state
 */
export async function setupTestEnvironment(page: Page): Promise<void> {
	await verifyExtensionInstalled(page)
	await waitForWebviewText(page, "Welcome to Kilo Code!")
	await configureApiKeyThroughUI(page)
	await waitForWebviewText(page, "Generate, refactor, and debug code with AI assistance")
}
