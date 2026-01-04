// kilocode_change - new file
/**
 * Token bucket rate limiter for API calls
 * Prevents exceeding API rate limits for external services
 */

export interface RateLimiterConfig {
	maxRequests: number
	windowMs: number
}

export class RateLimiter {
	private tokens: number
	private maxTokens: number
	private windowMs: number
	private lastRefill: number
	private queue: Array<() => void> = []

	constructor(config: RateLimiterConfig) {
		this.maxTokens = config.maxRequests
		this.tokens = config.maxRequests
		this.windowMs = config.windowMs
		this.lastRefill = Date.now()
	}

	/**
	 * Refill tokens based on elapsed time
	 */
	private refill(): void {
		const now = Date.now()
		const elapsed = now - this.lastRefill

		if (elapsed >= this.windowMs) {
			// Full refill
			this.tokens = this.maxTokens
			this.lastRefill = now
		} else {
			// Partial refill based on elapsed time
			const refillAmount = (elapsed / this.windowMs) * this.maxTokens
			this.tokens = Math.min(this.maxTokens, this.tokens + refillAmount)
			this.lastRefill = now
		}
	}

	/**
	 * Try to consume a token immediately
	 * Returns true if token was consumed, false if rate limited
	 */
	tryConsume(): boolean {
		this.refill()

		if (this.tokens >= 1) {
			this.tokens -= 1
			return true
		}

		return false
	}

	/**
	 * Consume a token, waiting if necessary
	 * Returns a promise that resolves when token is available
	 */
	async consume(): Promise<void> {
		if (this.tryConsume()) {
			return
		}

		// Queue the request
		return new Promise((resolve) => {
			this.queue.push(resolve)
			this.processQueue()
		})
	}

	/**
	 * Process queued requests
	 */
	private processQueue(): void {
		if (this.queue.length === 0) {
			return
		}

		// Calculate time until next token
		const now = Date.now()
		const elapsed = now - this.lastRefill
		const timeUntilRefill = Math.max(0, this.windowMs - elapsed)

		setTimeout(() => {
			this.refill()
			if (this.tryConsume() && this.queue.length > 0) {
				const next = this.queue.shift()
				next?.()
				this.processQueue()
			}
		}, timeUntilRefill)
	}

	/**
	 * Get current token count
	 */
	getTokens(): number {
		this.refill()
		return this.tokens
	}

	/**
	 * Reset the rate limiter
	 */
	reset(): void {
		this.tokens = this.maxTokens
		this.lastRefill = Date.now()
		this.queue = []
	}
}

/**
 * Pre-configured rate limiters for different services
 */
export const RateLimiters = {
	// GitHub: 5000 requests/hour for authenticated
	github: new RateLimiter({ maxRequests: 5000, windowMs: 60 * 60 * 1000 }),

	// Jira: 1000 requests/hour (varies by plan)
	jira: new RateLimiter({ maxRequests: 1000, windowMs: 60 * 60 * 1000 }),

	// Slack: Tier-based, using conservative limit
	slack: new RateLimiter({ maxRequests: 100, windowMs: 60 * 1000 }),

	// Generic conservative limiter
	conservative: new RateLimiter({ maxRequests: 60, windowMs: 60 * 1000 }),
}
