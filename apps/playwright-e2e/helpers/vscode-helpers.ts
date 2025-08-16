import { type Page, expect } from "@playwright/test"

const modifier = process.platform === "darwin" ? "Meta" : "Control"

export async function verifyExtensionInstalled(page: Page) {
	try {
		const activityBarIcon = page.locator('[aria-label*="Kilo"], [title*="Kilo"]').first()
		expect(await activityBarIcon).toBeDefined()
		console.log("✅ Extension installed!")
	} catch (_error) {
		throw new Error("Failed to find the installed extension! Check if the build failed and try again.")
	}
}

export async function closeAllTabs(page: Page): Promise<void> {
	const tabs = page.locator(".tab a.label-name")
	const count = await tabs.count()
	if (count > 0) {
		// Close all editor tabs using the default keyboard command [Cmd+K Cmd+W]
		await page.keyboard.press(`${modifier}+K`)
		await page.keyboard.press(`${modifier}+W`)

		const dismissedTabs = page.locator(".tab a.label-name")
		await expect(dismissedTabs).not.toBeVisible()
	}
}

export async function waitForAllExtensionActivation(page: Page): Promise<void> {
	try {
		const activatingStatus = page.locator("text=Activating Extensions")
		const activatingStatusCount = await activatingStatus.count()
		if (activatingStatusCount > 0) {
			console.log("⌛️ Waiting for `Activating Extensions` to go away...")
			await activatingStatus.waitFor({ state: "hidden", timeout: 10000 })
		}
	} catch {
		// noop
	}
}

export async function switchToTheme(page: Page, themeName: string): Promise<void> {
	await page.keyboard.press(`${modifier}+K`)
	await page.waitForTimeout(100)
	await page.keyboard.press(`${modifier}+T`)
	await page.waitForTimeout(100)

	await page.keyboard.type(themeName)
	await page.waitForTimeout(100)

	await page.keyboard.press("Enter")
	await page.waitForTimeout(100)
}
