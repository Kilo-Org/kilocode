// kilocode_change - new file
/**
 * Performance Monitor for Context Engine
 *
 * Monitors performance and automatically adjusts settings to prevent
 * task queue deadline exceeded warnings
 */

export interface PerformanceMetrics {
	averageParseTime: number
	memoryUsage: number
	queueLength: number
	errorRate: number
	lastTaskDuration: number
}

export interface PerformanceThresholds {
	maxParseTime: number // milliseconds
	maxMemoryUsage: number // percentage
	maxQueueLength: number
	maxErrorRate: number // percentage
}

const DEFAULT_THRESHOLDS: PerformanceThresholds = {
	maxParseTime: 50, // 50ms to stay under VS Code's deadline
	maxMemoryUsage: 0.6, // 60%
	maxQueueLength: 10,
	maxErrorRate: 0.1, // 10%
}

export class PerformanceMonitor {
	private metrics: PerformanceMetrics = {
		averageParseTime: 0,
		memoryUsage: 0,
		queueLength: 0,
		errorRate: 0,
		lastTaskDuration: 0,
	}

	private thresholds: PerformanceThresholds
	private parseTimes: number[] = []
	private errorCount = 0
	private totalTasks = 0
	private isThrottled = false

	constructor(thresholds: Partial<PerformanceThresholds> = {}) {
		this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds }
	}

	/**
	 * Record a task execution time
	 */
	recordTaskTime(duration: number): void {
		this.parseTimes.push(duration)
		this.totalTasks++

		// Keep only last 100 measurements
		if (this.parseTimes.length > 100) {
			this.parseTimes.shift()
		}

		// Update metrics
		this.metrics.lastTaskDuration = duration
		this.metrics.averageParseTime = this.parseTimes.reduce((a, b) => a + b, 0) / this.parseTimes.length
		this.updateMemoryUsage()
	}

	/**
	 * Record an error
	 */
	recordError(): void {
		this.errorCount++
		this.metrics.errorRate = this.errorCount / Math.max(this.totalTasks, 1)
	}

	/**
	 * Update queue length
	 */
	updateQueueLength(length: number): void {
		this.metrics.queueLength = length
	}

	/**
	 * Check if performance is degraded
	 */
	isPerformanceDegraded(): boolean {
		return (
			this.metrics.averageParseTime > this.thresholds.maxParseTime ||
			this.metrics.memoryUsage > this.thresholds.maxMemoryUsage ||
			this.metrics.queueLength > this.thresholds.maxQueueLength ||
			this.metrics.errorRate > this.thresholds.maxErrorRate
		)
	}

	/**
	 * Get current performance metrics
	 */
	getMetrics(): PerformanceMetrics {
		return { ...this.metrics }
	}

	/**
	 * Get performance recommendations
	 */
	getRecommendations(): string[] {
		const recommendations: string[] = []

		if (this.metrics.averageParseTime > this.thresholds.maxParseTime) {
			recommendations.push("Reduce maxFileSize or enable file filtering")
		}

		if (this.metrics.memoryUsage > this.thresholds.maxMemoryUsage) {
			recommendations.push("Increase debounceDelay or reduce concurrent operations")
		}

		if (this.metrics.queueLength > this.thresholds.maxQueueLength) {
			recommendations.push("Enable background processing or increase debounce delay")
		}

		if (this.metrics.errorRate > this.thresholds.maxErrorRate) {
			recommendations.push("Check file exclusions or reduce parsing complexity")
		}

		return recommendations
	}

	/**
	 * Auto-adjust settings based on performance
	 */
	getOptimalSettings(): Partial<any> {
		const settings: any = {}

		if (this.isPerformanceDegraded()) {
			// Reduce file size limit
			if (this.metrics.averageParseTime > this.thresholds.maxParseTime) {
				settings.maxFileSize = Math.max(128 * 1024, settings.maxFileSize * 0.8)
			}

			// Increase debounce delay
			if (this.metrics.queueLength > this.thresholds.maxQueueLength) {
				settings.debounceDelay = Math.min(5000, (settings.debounceDelay || 1000) * 1.5)
			}

			// Reduce memory usage threshold
			if (this.metrics.memoryUsage > this.thresholds.maxMemoryUsage) {
				settings.maxMemoryUsage = Math.max(0.3, this.thresholds.maxMemoryUsage * 0.8)
			}

			this.isThrottled = true
		} else if (this.isThrottled && this.canRelaxSettings()) {
			// Gradually relax settings if performance is good
			settings.maxFileSize = Math.min(1024 * 1024, (settings.maxFileSize || 512 * 1024) * 1.1)
			settings.debounceDelay = Math.max(500, (settings.debounceDelay || 1000) * 0.9)
			settings.maxMemoryUsage = Math.min(0.7, (settings.maxMemoryUsage || 0.5) * 1.1)

			this.isThrottled = false
		}

		return settings
	}

	/**
	 * Reset metrics
	 */
	reset(): void {
		this.metrics = {
			averageParseTime: 0,
			memoryUsage: 0,
			queueLength: 0,
			errorRate: 0,
			lastTaskDuration: 0,
		}
		this.parseTimes = []
		this.errorCount = 0
		this.totalTasks = 0
		this.isThrottled = false
	}

	private updateMemoryUsage(): void {
		if (typeof process !== "undefined" && process.memoryUsage) {
			const memory = process.memoryUsage()
			this.metrics.memoryUsage = memory.heapUsed / memory.heapTotal
		}
	}

	private canRelaxSettings(): boolean {
		// Only relax if performance has been good for a while
		return (
			this.parseTimes.length >= 20 &&
			this.metrics.averageParseTime < this.thresholds.maxParseTime * 0.7 &&
			this.metrics.memoryUsage < this.thresholds.maxMemoryUsage * 0.7 &&
			this.metrics.queueLength < this.thresholds.maxQueueLength * 0.5
		)
	}
}

// Global performance monitor instance
let performanceMonitor: PerformanceMonitor | null = null

export function getPerformanceMonitor(): PerformanceMonitor {
	if (!performanceMonitor) {
		performanceMonitor = new PerformanceMonitor()
	}
	return performanceMonitor
}

export function resetPerformanceMonitor(): void {
	performanceMonitor = null
}

/**
 * Decorator to monitor function performance
 */
export function monitorPerformance<T extends (...args: any[]) => any>(target: T, context?: string): T {
	return ((...args: any[]) => {
		const start = Date.now()
		const monitor = getPerformanceMonitor()

		try {
			const result = target(...args)

			// Handle both sync and async functions
			if (result instanceof Promise) {
				return result
					.then((value) => {
						monitor.recordTaskTime(Date.now() - start)
						return value
					})
					.catch((error) => {
						monitor.recordError()
						monitor.recordTaskTime(Date.now() - start)
						throw error
					})
			} else {
				monitor.recordTaskTime(Date.now() - start)
				return result
			}
		} catch (error) {
			monitor.recordError()
			monitor.recordTaskTime(Date.now() - start)
			throw error
		}
	}) as T
}
