import { type Page, expect } from "@playwright/test"
import { findWebview } from "./webview-helpers"

export type EnhanceButtonState = "enhance" | "cancel" | "revert"

const ENHANCE_BUTTON_LABELS = {
	enhance: "Enhance prompt with additional context",
	cancel: "Cancel enhancement",
	revert: "Revert to original prompt",
} as const

/**
 * Gets the enhance prompt button from the webview
 */
export async function getEnhanceButton(page: Page) {
	const webviewFrame = await findWebview(page)
	const enhanceButton = webviewFrame.locator('[data-testid="enhance-prompt-button"]')
	await enhanceButton.waitFor({ timeout: 10000 })
	return enhanceButton
}

/**
 * Waits for the enhance button to be in a specific state
 */
export async function waitForEnhanceButtonState(
	page: Page,
	state: EnhanceButtonState,
	timeout: number = 30000,
): Promise<void> {
	const enhanceButton = await getEnhanceButton(page)
	const expectedLabel = ENHANCE_BUTTON_LABELS[state]
	await expect(enhanceButton).toHaveAttribute("aria-label", expectedLabel, { timeout })
}

/**
 * Clicks the enhance button and optionally waits for a specific state
 */
export async function clickEnhanceButton(
	page: Page,
	waitForState?: EnhanceButtonState,
	timeout?: number,
): Promise<void> {
	const enhanceButton = await getEnhanceButton(page)
	await enhanceButton.click()

	if (waitForState) {
		await waitForEnhanceButtonState(page, waitForState, timeout)
	}
}

/**
 * Starts enhancement process and waits for loading state
 */
export async function startEnhancement(page: Page): Promise<void> {
	await clickEnhanceButton(page, "cancel", 5000)
}

/**
 * Cancels an ongoing enhancement
 */
export async function cancelEnhancement(page: Page): Promise<void> {
	await clickEnhanceButton(page, "enhance", 5000)
}

/**
 * Reverts to original prompt after enhancement
 */
export async function revertToOriginal(page: Page): Promise<void> {
	await clickEnhanceButton(page, "enhance", 5000)
}

/**
 * Performs full enhancement cycle: start -> wait for completion
 */
export async function completeEnhancement(page: Page): Promise<void> {
	await startEnhancement(page)
	await waitForEnhanceButtonState(page, "revert", 30000)
}

/**
 * Verifies the enhance button is in the expected initial state
 */
export async function verifyEnhanceButtonReady(page: Page): Promise<void> {
	const enhanceButton = await getEnhanceButton(page)
	await expect(enhanceButton).toHaveAttribute("aria-label", ENHANCE_BUTTON_LABELS.enhance)
	await expect(enhanceButton).toBeVisible()
	await expect(enhanceButton).toBeEnabled()
}
