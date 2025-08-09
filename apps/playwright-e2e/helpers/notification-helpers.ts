// kilocode_change - new file
import { type Page } from "@playwright/test"

/**
 * Closes all visible notification toasts in VSCode
 * @param page - The Playwright page instance
 */
export async function closeAllToastNotifications(page: Page): Promise<void> {
	try {
		let closedCount = 0

		// Keep closing notifications until none are found
		while (true) {
			const notificationItems = page.locator(".notification-list-item")
			const notificationCount = await notificationItems.count()
			if (notificationCount === 0) {
				return
			}

			const notification = notificationItems.first()
			const isVisible = await notification.isVisible().catch(() => false)
			if (isVisible) {
				await notification.hover()
				const closeButton = notification.locator(".codicon-notifications-clear")
				const closeButtonExists = (await closeButton.count()) > 0

				if (closeButtonExists) {
					await closeButton.click()
					closedCount++
					console.log(`✅ Closed notification #${closedCount}`)
					await page.waitForTimeout(100)
				} else {
					// No close button found, break to avoid infinite loop
					console.log(`⚠️ No close button found for notification, stopping`)
					break
				}
			} else {
				// Notification not visible, break to avoid infinite loop
				console.log(`⚠️ Notification not visible, stopping`)
				break
			}
		}
	} catch (_error) {
		console.log(`Ignoring error in closeAllToastNotifications`, _error)
		return
	}
}
