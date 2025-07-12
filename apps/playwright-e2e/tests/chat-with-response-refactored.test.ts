import { test, type TestFixtures } from "./playwright-base-test"
import { setupTestEnvironment, sendMessage, waitForWebviewText } from "../helpers"

test.describe("Full E2E Test (Refactored)", () => {
	test("should configure credentials and send a message", async ({ workbox: page }: TestFixtures) => {
		await setupTestEnvironment(page)
		await sendMessage(page, "Output only the result of '1+1'")
		await waitForWebviewText(page, "2", 30_000)
	})
})
