import { test } from "./playwright-base-test"
import {
	verifyExtensionInstalled,
	upsertApiConfiguration,
	waitForWebviewText,
	findWebview as findWebview,
} from "../helpers/webview-helpers"

test.describe("Full E2E Test", () => {
	test("should configure credentials and send a message", async ({ workbox }) => {
		const page = workbox

		await verifyExtensionInstalled(page)

		await waitForWebviewText(page, "What can Kilo Code do for you?")

		await upsertApiConfiguration(page)

		await waitForWebviewText(page, "Generate, refactor, and debug code with AI assistance")

		const webviewFrame = await findWebview(page)
		const chatInput = webviewFrame.locator('textarea, input[type="text"]').first()
		await chatInput.waitFor({ timeout: 5000 })

		await chatInput.fill("Output only the result of '1+1'")
		await chatInput.press("Enter")
		await waitForWebviewText(page, "2", 30_000)
	})
})
