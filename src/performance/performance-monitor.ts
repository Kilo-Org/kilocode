// kilocode_change - Performance optimization: Performance monitoring and metrics

/**
 * Performance monitoring and metrics collection
 */
export interface PerformanceMetrics {
	requestId: string
	operation: string
	startTime: number
	endTime?: number
	duration?: number
	memoryUsage?: NodeJS.MemoryUsage
	cpuUsage?: NodeJS.CpuUsage
	success: boolean
	error?: string
}

export interface PerformanceStats {
	totalRequests: number
	averageResponseTime: number
	slowRequests: number
	errorRate: number
	cacheHitRate: number
	memoryUsage: {
		peak: number
		average: number
	}
}

export class PerformanceMonitor {
	private metrics: PerformanceMetrics[] = []
	private stats: PerformanceStats = {
		totalRequests: 0,
		averageResponseTime: 0,
		slowRequests: 0,
		errorRate: 0,
		cacheHitRate: 0,
		memoryUsage: {
			peak: 0,
			average: 0,
		},
	}
	private readonly SLOW_REQUEST_THRESHOLD = 2000 // 2 seconds
	private readonly MAX_METRICS = 1000

	/**
	 * Start monitoring a request
	 */
	startMonitoring(requestId: string, operation: string): void {
		const metric: PerformanceMetrics = {
			requestId,
			operation,
			startTime: Date.now(),
			success: false,
		}

		this.metrics.push(metric)

		// Clean up old metrics
		if (this.metrics.length > this.MAX_METRICS) {
			this.metrics = this.metrics.slice(-this.MAX_METRICS)
		}
	}

	/**
	 * End monitoring for a request
	 */
	endMonitoring(requestId: string, success: boolean, error?: string): void {
		const metric = this.metrics.find((m) => m.requestId === requestId)
		if (!metric) return

		metric.endTime = Date.now()
		metric.duration = metric.endTime - metric.startTime
		metric.success = success
		metric.error = error
		metric.memoryUsage = process.memoryUsage()
		metric.cpuUsage = process.cpuUsage()

		this.updateStats()
	}

	/**
	 * Update performance statistics
	 */
	private updateStats(): void {
		const completedMetrics = this.metrics.filter((m) => m.endTime !== undefined)

		this.stats.totalRequests = completedMetrics.length
		this.stats.errorRate = completedMetrics.filter((m) => !m.success).length / completedMetrics.length

		if (completedMetrics.length > 0) {
			const totalDuration = completedMetrics.reduce((sum, m) => sum + (m.duration || 0), 0)
			this.stats.averageResponseTime = totalDuration / completedMetrics.length
			this.stats.slowRequests = completedMetrics.filter(
				(m) => (m.duration || 0) > this.SLOW_REQUEST_THRESHOLD,
			).length

			// Memory usage statistics
			const memoryUsages = completedMetrics
				.map((m) => m.memoryUsage)
				.filter((m): m is NodeJS.MemoryUsage => m !== undefined)
			if (memoryUsages.length > 0) {
				const totalMemory = memoryUsages.reduce((sum, m) => sum + m.heapUsed, 0)
				this.stats.memoryUsage.average = totalMemory / memoryUsages.length
				this.stats.memoryUsage.peak = Math.max(...memoryUsages.map((m) => m.heapUsed))
			}
		}
	}

	/**
	 * Get current performance statistics
	 */
	getStats(): PerformanceStats {
		return { ...this.stats }
	}

	/**
	 * Get recent metrics for debugging
	 */
	getRecentMetrics(count: number = 50): PerformanceMetrics[] {
		return this.metrics.filter((m) => m.endTime !== undefined).slice(-count)
	}

	/**
	 * Clear all metrics
	 */
	clearMetrics(): void {
		this.metrics = []
		this.stats = {
			totalRequests: 0,
			averageResponseTime: 0,
			slowRequests: 0,
			errorRate: 0,
			cacheHitRate: 0,
			memoryUsage: {
				peak: 0,
				average: 0,
			},
		}
	}

	/**
	 * Log performance summary
	 */
	logPerformanceSummary(): void {
		console.log(`[Performance Monitor] Summary:
Total Requests: ${this.stats.totalRequests}
Average Response Time: ${this.stats.averageResponseTime.toFixed(2)}ms
Slow Requests: ${this.stats.slowRequests}
Error Rate: ${(this.stats.errorRate * 100).toFixed(2)}%
Peak Memory Usage: ${(this.stats.memoryUsage.peak / 1024 / 1024).toFixed(2)}MB`)
	}
}

// Singleton instance for global use
export const performanceMonitor = new PerformanceMonitor()
