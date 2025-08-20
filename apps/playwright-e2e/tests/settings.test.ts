import { test, expect, type TestFixtures } from "./playwright-base-test"
import { verifyExtensionInstalled, findWebview, upsertApiConfiguration } from "../helpers/webview-helpers"
import { closeAllToastNotifications } from "../helpers"

test.describe("Settings", () => {
	test("screenshots", async ({ workbox: page, takeScreenshot }: TestFixtures) => {
		await verifyExtensionInstalled(page)
		await upsertApiConfiguration(page)

		// Open the settings then move the mouse to avoid triggering the tooltip
		page.locator('[aria-label*="Settings"], [title*="Settings"]').first().click()
		await page.mouse.move(0, 0)
		await page.mouse.click(0, 0)

		const webviewFrame = await findWebview(page)
		await expect(webviewFrame.locator('[role="tablist"]')).toBeVisible({ timeout: 10000 })
		console.log("✅ Settings view loaded")

		await expect(webviewFrame.locator('[data-testid="settings-tab-list"]')).toBeVisible()
		console.log("✅ Settings tab list visible")

		const tabButtons = webviewFrame.locator('[role="tab"]')
		const tabCount = await tabButtons.count()
		console.log(`✅ Found ${tabCount} settings tabs`)

		// Take screenshot of each tab (except for the last two)
		// MCP settings page is flakey and the info page has the version which changes
		for (let i = 0; i < tabCount - 2; i++) {
			const tabButton = tabButtons.nth(i)
			await tabButton.click()
			await page.waitForTimeout(500)

			const tabText = await tabButton.textContent()
			const tabName = tabText?.trim() || `tab-${i}`

			const testId = await tabButton.getAttribute("data-testid")
			const sectionId = testId?.replace("tab-", "") || `section-${i}`

			await closeAllToastNotifications(page)
			await takeScreenshot(`${i}-settings-${sectionId}-${tabName.toLowerCase().replace(/\s+/g, "-")}`)
		}

		console.log("✅ All settings tabs screenshots completed")
	})
})
