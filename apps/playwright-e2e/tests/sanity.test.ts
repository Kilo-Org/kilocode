import { test, expect, type TestFixtures } from "./playwright-base-test"
import { verifyExtensionInstalled } from "../helpers/webview-helpers"

test.describe("Sanity Tests", () => {
	test("should launch VS Code with extension installed", async ({ workbox: page, takeScreenshot }: TestFixtures) => {
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

		await verifyExtensionInstalled(page)

		await takeScreenshot("sanity-extension-loaded")
	})
})
