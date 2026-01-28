export class RateLimitMonitor {
	private static usageCount = 0
	private static resetTime: number | null = null
	private static readonly FREE_LIMIT = 50 // requests per hour for free models
	private static notifyCallback: ((resetTime: number) => void) | null = null

	static setNotifyCallback(callback: (resetTime: number) => void): void {
		this.notifyCallback = callback
	}

	static trackApiCall(modelId: string, isFreeModel: boolean): void {
		// Only track free model usage
		if (!isFreeModel) return

		this.usageCount++

		if (this.usageCount >= this.FREE_LIMIT) {
			this.setRateLimited()
		}
	}

	static isRateLimited(): boolean {
		if (this.resetTime && Date.now() > this.resetTime) {
			this.reset()
			return false
		}
		return this.usageCount >= this.FREE_LIMIT
	}

	static getStatus() {
		return {
			isLimited: this.isRateLimited(),
			resetTime: this.resetTime,
			usageCount: this.usageCount,
			limit: this.FREE_LIMIT,
		}
	}

	private static setRateLimited(): void {
		this.resetTime = Date.now() + 60 * 60 * 1000 // 1 hour

		// Notify via callback if set
		if (this.notifyCallback) {
			this.notifyCallback(this.resetTime)
		}
	}

	private static reset(): void {
		this.usageCount = 0
		this.resetTime = null
	}
}
