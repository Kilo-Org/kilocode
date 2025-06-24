import { test, expect } from "./playwright-base-test"
import { verifyExtensionInstalled, findWebview } from "../helpers/webview-helpers"

test.describe("Sanity Tests", () => {
	test("should launch VS Code with extension installed", async ({ workbox }) => {
		const page = workbox

		await expect(page.locator(".monaco-workbench")).toBeVisible()
		console.log("✅ VS Code launched successfully")

		await expect(page.locator(".activitybar")).toBeVisible()
		console.log("✅ Activity bar visible")

		await page.keyboard.press("Meta+Shift+P")
		const commandPalette = page.locator(".quick-input-widget")
		await expect(commandPalette).toBeVisible()

		await page.keyboard.press("Escape")
		await expect(commandPalette).not.toBeVisible()
		console.log("✅ Command palette working")

		await verifyExtensionInstalled(page)
		await findWebview(page)

		console.log("✅ Extension installed and webview loaded!")
		await page.screenshot({ path: "screenshots/sanity.png" })
	})
})
