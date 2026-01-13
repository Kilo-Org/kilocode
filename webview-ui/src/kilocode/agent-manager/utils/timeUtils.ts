export interface RelativeTimeLabels {
	justNow: string
	minuteAgo: string
	minutesAgo: (count: number) => string
	hourAgo: string
	hoursAgo: (count: number) => string
	dayAgo: string
	daysAgo: (count: number) => string
	weekAgo: string
	weeksAgo: (count: number) => string
}

/**
 * Formats a timestamp as a human-readable relative time string
 * @param timestamp - Unix timestamp in milliseconds
 * @param labels - Localized labels for time units
 * @returns Formatted relative time string, or empty string if timestamp is invalid
 */
export function formatRelativeTime(timestamp: number, labels: RelativeTimeLabels): string {
	if (!timestamp || isNaN(timestamp)) {
		return ""
	}

	const now = Date.now()
	const diff = now - timestamp
	const seconds = Math.floor(diff / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)

	if (days > 7) {
		const weeks = Math.floor(days / 7)
		return weeks === 1 ? labels.weekAgo : labels.weeksAgo(weeks)
	}
	if (days > 0) {
		return days === 1 ? labels.dayAgo : labels.daysAgo(days)
	}
	if (hours > 0) {
		return hours === 1 ? labels.hourAgo : labels.hoursAgo(hours)
	}
	if (minutes > 0) {
		return minutes === 1 ? labels.minuteAgo : labels.minutesAgo(minutes)
	}
	return labels.justNow
}

/**
 * Creates RelativeTimeLabels from an i18next translation function
 */
export function createRelativeTimeLabels(t: (key: string, options?: { count: number }) => string): RelativeTimeLabels {
	return {
		justNow: t("time.justNow"),
		minuteAgo: t("time.minuteAgo"),
		minutesAgo: (count: number) => t("time.minutesAgo", { count }),
		hourAgo: t("time.hourAgo"),
		hoursAgo: (count: number) => t("time.hoursAgo", { count }),
		dayAgo: t("time.dayAgo"),
		daysAgo: (count: number) => t("time.daysAgo", { count }),
		weekAgo: t("time.weekAgo"),
		weeksAgo: (count: number) => t("time.weeksAgo", { count }),
	}
}
