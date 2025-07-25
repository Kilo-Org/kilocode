// kilocode_change - new file
import { test, type TestFixtures } from "./playwright-base-test"
import { sendMessage, waitForWebviewText, verifyExtensionInstalled, configureApiKeyThroughUI } from "../helpers"

test.describe("E2E Chat Test", () => {
	test("should configure credentials and send a message", async ({ workbox: page, takeScreenshot }: TestFixtures) => {
		await verifyExtensionInstalled(page)
		await waitForWebviewText(page, "Welcome to Kilo Code!")
		await takeScreenshot("welcome")

		await configureApiKeyThroughUI(page)
		await waitForWebviewText(page, "Generate, refactor, and debug code with AI assistance")
		await takeScreenshot("ready-to-chat")

		await sendMessage(page, "Fill in the blanks for this phrase: 'hello w_r_d'")

		// Don't take any more screenshots after the reponse starts-
		// llm responses aren't deterministic any capturing the reponse would cause screenshot flakes
		await waitForWebviewText(page, "hello world", 30_000)
	})
})
