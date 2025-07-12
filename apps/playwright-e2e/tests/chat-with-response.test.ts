import { test, type TestFixtures } from "./playwright-base-test"
import {
	verifyExtensionInstalled,
	waitForWebviewText,
	findWebview as findWebview,
	configureApiKeyThroughUI,
} from "../helpers/webview-helpers"

test.describe("Full E2E Test", () => {
	test("should configure credentials and send a message", async ({ workbox: page, takeScreenshot }: TestFixtures) => {
		await verifyExtensionInstalled(page)

		await waitForWebviewText(page, "Welcome to Kilo Code!")
		await takeScreenshot("welcome")

		await configureApiKeyThroughUI(page)
		await waitForWebviewText(page, "Generate, refactor, and debug code with AI assistance")
		await takeScreenshot("ready-to-chat")

		const webviewFrame = await findWebview(page)
		const chatInput = webviewFrame.locator('textarea, input[type="text"]').first()
		await chatInput.waitFor()

		await chatInput.fill("Fill in the blanks for this phrase: 'hello w_r_d'")
		await takeScreenshot("chat-prompt-entered")

		// Don't take any more screenshots after the reponse starts-
		// llm responses aren't deterministic any capturing the reponse would cause screenshot flakes
		await chatInput.press("Enter")
		await waitForWebviewText(page, "hello world", 30_000)
	})
})
