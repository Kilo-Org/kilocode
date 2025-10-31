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
		console.log("⏳ Waiting for VSCode initialization to complete...")

		// Wait for the status.progress element to disappear
		const progressElement = page.locator("#status\\.progress")
		const progressExists = (await progressElement.count()) > 0

		if (progressExists) {
			const ariaLabel = await progressElement.getAttribute("aria-label").catch(() => "Unknown")
			console.log(`⌛️ Still initializing: ${ariaLabel}`)

			await progressElement.waitFor({ state: "hidden", timeout: 10000 })
			console.log("✅ VSCode initialization complete")
		} else {
			console.log("✅ VSCode initialization already complete")
		}
	} catch (error) {
		console.log("⚠️ Error waiting for VSCode initialization:", error)
		// Don't throw - we don't want to fail tests if initialization check fails
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

export async function executeVSCodeCommand(page: Page, commandName: string): Promise<void> {
	// Open command palette
	await page.keyboard.press(`${modifier}+Shift+P`)
	await page.waitForTimeout(100)

	// Type the command name
	await page.keyboard.type(commandName)
	await page.keyboard.press("Enter")
	await page.waitForTimeout(300)
}
