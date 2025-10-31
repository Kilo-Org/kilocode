import { test, expect, type TestFixtures } from "./playwright-base-test"
import {
	findWebview,
	upsertApiConfiguration,
	verifyExtensionInstalled,
	clickSaveSettingsButton,
	waitForTooltipsToDismiss,
} from "../helpers"

test.describe("Settings", () => {
	test("screenshots", async ({ workbox: page, takeScreenshot }: TestFixtures) => {
		await verifyExtensionInstalled(page)
		await upsertApiConfiguration(page)

		// Open the settings then move the mouse to avoid triggering the tooltip
		const webviewFrame = await findWebview(page)
		await page.locator('[aria-label*="Settings"], [title*="Settings"]').first().click()
		await page.mouse.move(0, 0) // Move cursor to top-left corner to avoid triggering hover states

		await clickSaveSettingsButton(webviewFrame)
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

			await clickSaveSettingsButton(webviewFrame) // To avoid flakey screenshots
			await waitForTooltipsToDismiss(webviewFrame) // Wait for tooltips to dismiss before screenshot
			await takeScreenshot(`${i}-settings-${sectionId}-${tabName.toLowerCase().replace(/\s+/g, "-")}`)
		}

		console.log("✅ All settings tabs screenshots completed")
	})
})
