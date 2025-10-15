// kilocode_change - new file
import { type Page } from "@playwright/test"

/**
 * Waits for DOM stability by injecting a MutationObserver into the page.
 * Monitors all DOM changes and waits for 250ms of inactivity before resolving.
 * Includes a 10-second timeout to prevent infinite waiting.
 *
 * @param page - The Playwright page instance
 * @returns Promise that resolves when DOM is stable or timeout occurs
 */
export async function waitForDOMStability(page: Page): Promise<void> {
	await page.evaluate(() => {
		return new Promise<void>((resolve) => {
			const DEBOUNCE_DELAY = 250 // ms
			const MAX_TIMEOUT = 10000 // ms

			let debounceTimer: NodeJS.Timeout | null = null
			let timeoutTimer: NodeJS.Timeout | null = null
			let observer: MutationObserver | null = null

			const cleanup = () => {
				if (debounceTimer) {
					clearTimeout(debounceTimer)
					debounceTimer = null
				}
				if (timeoutTimer) {
					clearTimeout(timeoutTimer)
					timeoutTimer = null
				}
				if (observer) {
					observer.disconnect()
					observer = null
				}
			}

			const resolveStability = () => {
				cleanup()
				resolve()
			}

			const resetDebounceTimer = () => {
				if (debounceTimer) {
					clearTimeout(debounceTimer)
				}
				debounceTimer = setTimeout(resolveStability, DEBOUNCE_DELAY)
			}

			// Set up maximum timeout protection
			timeoutTimer = setTimeout(() => {
				console.log("DOM stability timeout reached (10s)")
				resolveStability()
			}, MAX_TIMEOUT)

			// Create and configure MutationObserver
			observer = new MutationObserver(() => {
				resetDebounceTimer()
			})

			// Start observing all types of DOM changes
			observer.observe(document.body, {
				childList: true, // Node additions/removals
				attributes: true, // Attribute changes
				characterData: true, // Text content changes
				subtree: true, // Monitor entire DOM tree
			})

			// Start initial debounce timer
			resetDebounceTimer()
		})
	})
}
