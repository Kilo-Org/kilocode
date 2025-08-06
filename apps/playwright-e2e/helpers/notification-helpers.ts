// kilocode_change - new file
import { type Page } from "@playwright/test"

/**
 * Closes all visible notification toasts in VSCode
 * @param page - The Playwright page instance
 * @param timeout - Maximum time to wait for notifications
 */
export async function closeAllToastNotifications(page: Page, timeout: number = 0): Promise<void> {
	try {
		await page.waitForSelector(".notification-list-item", { timeout })

		// Handle notification-list-item notifications (the ones we found working)
		const notificationItems = page.locator(".notification-list-item")
		const notificationCount = await notificationItems.count()
		console.log(`🔍 Found ${notificationCount} notifications to close...`)

		// Close notifications by hovering and clicking their close buttons
		for (let i = 0; i < notificationCount; i++) {
			const notification = notificationItems.nth(i)
			const isVisible = await notification.isVisible().catch(() => false)
			if (isVisible) {
				await notification.hover()
				const closeButton = notification.locator(".codicon-notifications-clear")
				await closeButton.click()
			}
		}
	} catch {
		return // No notifications found! That's ok
	}
}
