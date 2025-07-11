import { test, expect, type TestFixtures } from "./playwright-base-test"
import { verifyExtensionInstalled, findWebview, upsertApiConfiguration } from "../helpers/webview-helpers"

test.describe("Settings Screenshots", () => {
	test("should take screenshots of all settings tabs", async ({ workbox: page, takeScreenshot }: TestFixtures) => {
		await verifyExtensionInstalled(page)

		// Configure API to ensure settings are accessible
		await upsertApiConfiguration(page)

		// Open the settings by clicking the settings button in the activity bar
		const settingsButton = page.locator('[aria-label*="Settings"], [title*="Settings"]').first()
		if (await settingsButton.isVisible()) {
			await settingsButton.click()
		} else {
			// Alternative: Use keyboard shortcut to open command palette and run settings command
			const modifier = process.platform === "darwin" ? "Meta" : "Control"
			await page.keyboard.press(`${modifier}+Shift+P`)
			await page.keyboard.type("Kilo Code: Settings")
			await page.keyboard.press("Enter")
		}

		// Wait for the webview to load
		const webviewFrame = await findWebview(page)

		// Wait for settings view to be visible
		await expect(webviewFrame.locator('[data-testid="settings-view"]')).toBeVisible({ timeout: 10000 })
		console.log("✅ Settings view loaded")

		// Wait for the tab list to be visible
		await expect(webviewFrame.locator('[data-testid="settings-tab-list"]')).toBeVisible()
		console.log("✅ Settings tab list visible")

		// Find all tab buttons with role="tab"
		const tabButtons = webviewFrame.locator('[role="tab"]')
		const tabCount = await tabButtons.count()
		console.log(`✅ Found ${tabCount} settings tabs`)

		// Take screenshot of each tab
		for (let i = 0; i < tabCount; i++) {
			const tabButton = tabButtons.nth(i)

			// Get the tab name from the text content
			const tabText = await tabButton.textContent()
			const tabName = tabText?.trim() || `tab-${i}`

			// Get the data-testid attribute to get the section ID
			const testId = await tabButton.getAttribute("data-testid")
			const sectionId = testId?.replace("tab-", "") || `section-${i}`

			console.log(`📸 Taking screenshot of tab: ${tabName} (${sectionId})`)

			// Click the tab to activate it
			await tabButton.click()

			// Wait a moment for the content to load
			await page.waitForTimeout(500)

			// Take screenshot with descriptive name
			const screenshotName = `settings-${sectionId}-${tabName.toLowerCase().replace(/\s+/g, "-")}`
			await takeScreenshot(screenshotName)
		}

		console.log("✅ All settings tabs screenshots completed")
	})
})
