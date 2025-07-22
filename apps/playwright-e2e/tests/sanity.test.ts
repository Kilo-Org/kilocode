// kilocode_change - new file
import { setupTestEnvironment } from "../helpers"
import { test, expect, type TestFixtures } from "./playwright-base-test"

test.describe("Sanity Tests", () => {
	test("should launch VS Code with extension installed", async ({ workbox: page }: TestFixtures) => {
		await expect(page.locator(".monaco-workbench")).toBeVisible()
		console.log("✅ VS Code launched successfully")

		await expect(page.locator(".activitybar")).toBeVisible()
		console.log("✅ Activity bar visible")

		const modifier = process.platform === "darwin" ? "Meta" : "Control"
		const shortcut = `${modifier}+Shift+P`
		await page.keyboard.press(shortcut)
		const commandPalette = page.locator(".quick-input-widget")
		await expect(commandPalette).toBeVisible()

		await page.keyboard.press("Escape")
		await expect(commandPalette).not.toBeVisible()
		console.log("✅ Command palette working")

		await setupTestEnvironment(page)
	})
})
