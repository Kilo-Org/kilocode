// kilocode_change - new file
import { type Page, type FrameLocator, expect } from "@playwright/test"
import type { WebviewMessage } from "../../../src/shared/WebviewMessage"
import { ProviderSettings } from "@roo-code/types"

const defaultPlaywrightApiConfig = {
	apiProvider: "openrouter" as const,
	openRouterApiKey: process.env.OPENROUTER_API_KEY,
	openRouterModelId: "openai/gpt-4o-mini",
}

export async function findWebview(workbox: Page): Promise<FrameLocator> {
	const webviewFrameEl = workbox.frameLocator(
		'iframe[src*="extensionId=kilocode.kilo-code"][src*="purpose=webviewView"]',
	)
	await webviewFrameEl.locator("#active-frame")
	return webviewFrameEl.frameLocator("#active-frame")
}

export async function waitForWebviewText(page: Page, text: string, timeout: number = 30000): Promise<void> {
	const webviewFrame = await findWebview(page)
	await expect(webviewFrame.locator("body")).toContainText(text, { timeout })
}

export async function waitForModelSelector(page: Page, timeout: number = 30000): Promise<void> {
	const webviewFrame = await findWebview(page)
	await expect(webviewFrame.locator('[data-testid="model-selector"]')).toBeVisible({ timeout })
}

export async function postWebviewMessage(page: Page, message: WebviewMessage): Promise<void> {
	const webviewFrame = await findWebview(page)

	// Retry mechanism for VSCode API availability
	const maxRetries = 3
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			await webviewFrame.locator("body").evaluate((element, msg) => {
				if (!window.vscode) {
					throw new Error("Global vscode API not found")
				}

				window.vscode.postMessage(msg)
			}, message)
			return // Success - exit the retry loop
		} catch (error) {
			if (attempt === maxRetries) {
				throw error // Re-throw on final attempt
			}
			await page.waitForTimeout(1000)
		}
	}
}

export async function upsertApiConfiguration(page: Page, apiConfiguration?: Partial<ProviderSettings>): Promise<void> {
	await postWebviewMessage(page, {
		type: "upsertApiConfiguration",
		text: "default",
		apiConfiguration: apiConfiguration ?? defaultPlaywrightApiConfig,
	})
	await postWebviewMessage(page, { type: "currentApiConfigName", text: "default" })
}

export async function configureApiKeyThroughUI(page: Page): Promise<void> {
	const webviewFrame = await findWebview(page)
	console.log("✅ Webview found!")

	// Click "Use your own API key" button
	const useOwnKeyButton = webviewFrame.locator('button:has-text("Use your own API key")')
	await useOwnKeyButton.waitFor()
	await useOwnKeyButton.click()

	// Wait for the provider selection dropdown to appear
	const providerDropdown = webviewFrame.locator('[role="combobox"]').first()
	await providerDropdown.waitFor()
	await providerDropdown.click()

	// Select OpenRouter from the dropdown
	const openRouterOption = webviewFrame.locator('[role="option"]:has-text("OpenRouter")')
	await openRouterOption.waitFor()
	await openRouterOption.click()

	// Fill in the OpenRouter API key (password field)
	const apiKeyInput = webviewFrame.locator('input[type="password"]').first()
	await apiKeyInput.waitFor()
	await apiKeyInput.fill(process.env.OPENROUTER_API_KEY || "")
	console.log("✅ Filled in OpenRouter key!")

	// Submit the configuration by clicking "Let's go!" button
	const submitButton = webviewFrame.locator('button:has-text("Let\'s go!")')
	await submitButton.waitFor()
	await submitButton.click()
	console.log("✅ Provider configured!")
}

export async function clickSaveSettingsButton(webviewFrame: FrameLocator): Promise<void> {
	const saveButton = webviewFrame.locator('[data-testid="save-button"]')
	const saveButtonExists = (await saveButton.count()) > 0
	if (saveButtonExists) {
		await saveButton.click({ force: true }) // Click it even its disabled
	}
}

/**
 * Waits for all tooltips to be dismissed before proceeding.
 * This is necessary when tooltips appear after clicking elements and need to animate away
 * before taking screenshots to avoid inconsistent visual states.
 */
export async function waitForTooltipsToDismiss(webviewFrame: FrameLocator): Promise<void> {
	const tooltipContent = webviewFrame.locator('[data-slot="tooltip-content"]')
	await tooltipContent.waitFor({ state: "detached", timeout: 3000 }).catch(() => {
		// If timeout, tooltips should be gone by now anyway
	})
}

/**
 * Freezes all GIFs on the page by converting them to static PNG images.
 * Also sets up a MutationObserver to handle dynamically added GIFs.
 * Works inside the VSCode extension webview iframe.
 */
export async function freezeGifs(page: Page): Promise<void> {
	await page.emulateMedia({ reducedMotion: "reduce" })

	// Get the webview frame to work inside the extension iframe
	const webviewFrame = await findWebview(page)

	await webviewFrame.locator("body").evaluate(() => {
		// Function to freeze a single GIF
		const freezeGif = (img: HTMLImageElement) => {
			if (!img.src.toLowerCase().includes(".gif")) return
			if (img.dataset.gifFrozen === "true") return // Already processed

			const canvas = document.createElement("canvas")
			const ctx = canvas.getContext("2d")
			if (!ctx) return

			const frame = new Image()
			frame.crossOrigin = "anonymous"
			frame.onload = () => {
				canvas.width = frame.naturalWidth || frame.width
				canvas.height = frame.naturalHeight || frame.height
				ctx.drawImage(frame, 0, 0)
				img.src = canvas.toDataURL("image/png")
				img.dataset.gifFrozen = "true"
			}
			frame.onerror = () => {
				// Fallback: just mark as processed to avoid infinite loops
				img.dataset.gifFrozen = "true"
			}
			frame.src = img.src
		}

		// Freeze existing GIFs in the webview
		document.querySelectorAll('img[src*=".gif"]').forEach((img) => {
			freezeGif(img as HTMLImageElement)
		})
	})
}
