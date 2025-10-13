export const DELAY_VALUES = [
	50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000,
]

export function normalizeAutoTriggerDelay(value: number | undefined): number {
	if (value === undefined) return 3000
	if (value < 50) {
		return Math.min(value, 5) * 1000
	}
	return value
}

export function formatDelay(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`
	}
	return `${ms / 1000}s`
}
