// kilocode_change - new file
import { test, type TestFixtures } from "./playwright-base-test"
import {
	sendMessage,
	waitForWebviewText,
	verifyExtensionInstalled,
	configureApiKeyThroughUI,
	getChatInput,
	closeAllToastNotifications,
} from "../helpers"

test.describe("E2E Chat Test", () => {
	test("should configure credentials and send a message", async ({ workbox: page, takeScreenshot }: TestFixtures) => {
		await verifyExtensionInstalled(page)
		await waitForWebviewText(page, "Welcome to Kilo Code!")

		await page.waitForTimeout(1000) // Let the page settle to avoid flakes

		await closeAllToastNotifications(page)
		await takeScreenshot("welcome")

		await configureApiKeyThroughUI(page)
		await waitForWebviewText(page, "Generate, refactor, and debug code with AI assistance")

		await (await getChatInput(page)).focus()
		await page.waitForTimeout(1000) // Let the page settle to avoid flakes
		await takeScreenshot("ready-to-chat")

		// Don't take any more screenshots after the reponse starts-
		// llm responses aren't deterministic any capturing the reponse would cause screenshot flakes
		await sendMessage(page, "Fill in the blanks for this phrase: 'hello w_r_d'")
		await waitForWebviewText(page, "hello world", 30_000)
	})
})
