// kilocode_change - new file
import type { Page } from "@playwright/test"

const shouldIgnoreMessage = (message: string): boolean => {
	return (
		!message.trim() ||
		message.includes("DeprecationWarning: The `punycode` module is deprecated") ||
		message.includes("Failed to connect to PrepareForShutdown") ||
		message.includes("Failed to connect to PrepareForSleep") ||
		/^\d+:\d+\/\d+:\d+\.\d+:INFO:CONSOLE(\(\d+\))?\s*$/.test(message)
	)
}

const cleanMessage = (message: string): string => {
	return message
		.replace(/%c/g, "") // Remove color formatting
		.replace(/\[Extension Host\]\s*/g, "") // Remove extension host prefix
		.replace(/\(file:\/\/[^)]+\)/g, "") // Remove file paths
		.replace(/\s{2,}/g, " ") // Collapse multiple spaces
		.trim()
}

export const cleanLogMessage = (message: string): string | null => {
	if (shouldIgnoreMessage(message)) {
		return null
	}
	const cleaned = cleanMessage(message)
	return cleaned || null
}

export const setupConsoleLogging = (page: Page, prefix: string): void => {
	const verbose = process.env.PLAYWRIGHT_VERBOSE_LOGS === "true"

	page.on("console", (msg) => {
		const text = msg.text()

		if (!verbose && shouldIgnoreMessage(text)) {
			return
		}

		const cleaned = cleanMessage(text)
		if (cleaned) {
			console.log(`[${prefix}] ${cleaned}`)
		}
	})

	page.on("pageerror", (error) => {
		const cleaned = cleanMessage(error.message)
		if (cleaned) {
			console.log(`❌ [${prefix}] ${cleaned}`)
		}
	})

	page.on("requestfailed", (request) => {
		const url = request.url()
		const failure = request.failure()
		if (failure) {
			const message = `${request.method()} ${url} - ${failure.errorText}`
			console.log(`🚫 [${prefix} REQUEST FAILED] ${message}`)
		}
	})
}
