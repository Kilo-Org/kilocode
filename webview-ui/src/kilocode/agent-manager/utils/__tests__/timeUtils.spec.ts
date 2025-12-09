import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { formatRelativeTime, createRelativeTimeLabels, RelativeTimeLabels } from "../timeUtils"

const mockLabels: RelativeTimeLabels = {
	justNow: "Just now",
	minuteAgo: "A minute ago",
	minutesAgo: (count: number) => `${count} minutes ago`,
	hourAgo: "An hour ago",
	hoursAgo: (count: number) => `${count} hours ago`,
	dayAgo: "A day ago",
	daysAgo: (count: number) => `${count} days ago`,
	weekAgo: "A week ago",
	weeksAgo: (count: number) => `${count} weeks ago`,
}

describe("formatRelativeTime", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2024-01-15T12:00:00Z"))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("returns empty string for invalid timestamp (0)", () => {
		expect(formatRelativeTime(0, mockLabels)).toBe("")
	})

	it("returns empty string for NaN timestamp", () => {
		expect(formatRelativeTime(NaN, mockLabels)).toBe("")
	})

	it("returns 'Just now' for timestamps less than a minute ago", () => {
		const now = Date.now()
		const thirtySecondsAgo = now - 30 * 1000

		expect(formatRelativeTime(thirtySecondsAgo, mockLabels)).toBe("Just now")
	})

	it("returns 'A minute ago' for exactly 1 minute ago", () => {
		const now = Date.now()
		const oneMinuteAgo = now - 60 * 1000

		expect(formatRelativeTime(oneMinuteAgo, mockLabels)).toBe("A minute ago")
	})

	it("returns 'X minutes ago' for 2-59 minutes ago", () => {
		const now = Date.now()
		const fiveMinutesAgo = now - 5 * 60 * 1000

		expect(formatRelativeTime(fiveMinutesAgo, mockLabels)).toBe("5 minutes ago")
	})

	it("returns 'An hour ago' for exactly 1 hour ago", () => {
		const now = Date.now()
		const oneHourAgo = now - 60 * 60 * 1000

		expect(formatRelativeTime(oneHourAgo, mockLabels)).toBe("An hour ago")
	})

	it("returns 'X hours ago' for 2-23 hours ago", () => {
		const now = Date.now()
		const threeHoursAgo = now - 3 * 60 * 60 * 1000

		expect(formatRelativeTime(threeHoursAgo, mockLabels)).toBe("3 hours ago")
	})

	it("returns 'A day ago' for exactly 1 day ago", () => {
		const now = Date.now()
		const oneDayAgo = now - 24 * 60 * 60 * 1000

		expect(formatRelativeTime(oneDayAgo, mockLabels)).toBe("A day ago")
	})

	it("returns 'X days ago' for 2-6 days ago", () => {
		const now = Date.now()
		const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000

		expect(formatRelativeTime(threeDaysAgo, mockLabels)).toBe("3 days ago")
	})

	it("returns 'A week ago' for 7 days ago", () => {
		const now = Date.now()
		const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

		expect(formatRelativeTime(sevenDaysAgo, mockLabels)).toBe("7 days ago")
	})

	it("returns 'A week ago' for 8-13 days ago", () => {
		const now = Date.now()
		const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000

		expect(formatRelativeTime(eightDaysAgo, mockLabels)).toBe("A week ago")
	})

	it("returns 'X weeks ago' for 14+ days ago", () => {
		const now = Date.now()
		const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000

		expect(formatRelativeTime(fourteenDaysAgo, mockLabels)).toBe("2 weeks ago")
	})

	it("returns 'X weeks ago' for many weeks ago", () => {
		const now = Date.now()
		const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

		expect(formatRelativeTime(thirtyDaysAgo, mockLabels)).toBe("4 weeks ago")
	})
})

describe("createRelativeTimeLabels", () => {
	it("creates labels from translation function", () => {
		const mockT = vi.fn((key: string, options?: { count: number }) => {
			if (options?.count) {
				return `translated_${key}_${options.count}`
			}
			return `translated_${key}`
		})

		const labels = createRelativeTimeLabels(mockT)

		expect(labels.justNow).toBe("translated_time.justNow")
		expect(labels.minuteAgo).toBe("translated_time.minuteAgo")
		expect(labels.minutesAgo(5)).toBe("translated_time.minutesAgo_5")
		expect(labels.hourAgo).toBe("translated_time.hourAgo")
		expect(labels.hoursAgo(3)).toBe("translated_time.hoursAgo_3")
		expect(labels.dayAgo).toBe("translated_time.dayAgo")
		expect(labels.daysAgo(2)).toBe("translated_time.daysAgo_2")
		expect(labels.weekAgo).toBe("translated_time.weekAgo")
		expect(labels.weeksAgo(4)).toBe("translated_time.weeksAgo_4")
	})
})
