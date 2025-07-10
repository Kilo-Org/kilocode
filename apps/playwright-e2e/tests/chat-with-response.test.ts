import { test, type TestFixtures } from "./playwright-base-test"
import {
	verifyExtensionInstalled,
	waitForWebviewText,
	findWebview as findWebview,
	configureApiKeyThroughUI,
} from "../helpers/webview-helpers"

test.describe("Full E2E Test", () => {
	test("should configure credentials and send a message", async ({ workbox: page }: TestFixtures) => {
		await verifyExtensionInstalled(page)

		await waitForWebviewText(page, "Welcome to Kilo Code!")

		await configureApiKeyThroughUI(page)

		await waitForWebviewText(page, "Generate, refactor, and debug code with AI assistance")

		const webviewFrame = await findWebview(page)
		const chatInput = webviewFrame.locator('textarea, input[type="text"]').first()
		await chatInput.waitFor({ timeout: 5000 })

		await chatInput.fill("Output only the result of '1+1'")
		await chatInput.press("Enter")
		await waitForWebviewText(page, "2", 30_000)
	})
})
