import { type Page, expect } from "@playwright/test"
import { findWebview } from "./webview-helpers"

export type EnhanceButtonState = "enhance" | "cancel" | "revert"

const ENHANCE_BUTTON_LABELS = {
	enhance: "Enhance prompt with additional context",
	cancel: "Cancel enhancement",
	revert: "Revert to original prompt",
} as const

export async function getEnhanceButton(page: Page) {
	const webviewFrame = await findWebview(page)
	const enhanceButton = webviewFrame.locator('[data-testid="enhance-prompt-button"]')
	await enhanceButton.waitFor({ timeout: 10000 })
	return enhanceButton
}

export async function waitForEnhanceButtonState(
	page: Page,
	state: EnhanceButtonState,
	timeout: number = 30000,
): Promise<void> {
	const enhanceButton = await getEnhanceButton(page)
	const expectedLabel = ENHANCE_BUTTON_LABELS[state]
	await expect(enhanceButton).toHaveAttribute("aria-label", expectedLabel, { timeout })
}

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

export async function verifyEnhanceButtonReady(page: Page): Promise<void> {
	const enhanceButton = await getEnhanceButton(page)
	await expect(enhanceButton).toHaveAttribute("aria-label", ENHANCE_BUTTON_LABELS.enhance)
	await expect(enhanceButton).toBeVisible()
	await expect(enhanceButton).toBeEnabled()
}
