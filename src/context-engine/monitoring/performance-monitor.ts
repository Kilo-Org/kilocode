import type { PerformanceMetrics, IndexingStats } from "../types"
import { ContextEngine } from "../index"

/**
 * Performance monitor for tracking system health and metrics
 */
export class PerformanceMonitor {
	private engine: ContextEngine
	private metricsHistory: PerformanceMetrics[]
	private maxHistorySize: number
	private monitoringInterval: NodeJS.Timeout | null

	constructor(engine: ContextEngine, maxHistorySize: number = 100) {
		this.engine = engine
		this.metricsHistory = []
		this.maxHistorySize = maxHistorySize
		this.monitoringInterval = null
	}

	/**
	 * Start monitoring
	 */
	start(intervalMs: number = 60000): void {
		// Monitor every minute by default
		this.monitoringInterval = setInterval(() => {
			this.collect()
		}, intervalMs)
	}

	/**
	 * Stop monitoring
	 */
	stop(): void {
		if (this.monitoringInterval) {
			clearInterval(this.monitoringInterval)
			this.monitoringInterval = null
		}
	}

	/**
	 * Collect current metrics
	 */
	async collect(): Promise<PerformanceMetrics> {
		try {
			const metrics = await this.engine.getPerformanceMetrics()

			// Add to history
			this.metricsHistory.push(metrics)

			// Trim history if needed
			if (this.metricsHistory.length > this.maxHistorySize) {
				this.metricsHistory.shift()
			}

			// Check for anomalies
			this.checkHealth(metrics)

			return metrics
		} catch (error) {
			console.error("Failed to collect metrics:", error)
			throw error
		}
	}

	/**
	 * Get current metrics
	 */
	async getCurrentMetrics(): Promise<PerformanceMetrics> {
		return await this.engine.getPerformanceMetrics()
	}

	/**
	 * Get metrics history
	 */
	getHistory(): PerformanceMetrics[] {
		return [...this.metricsHistory]
	}

	/**
	 * Get average metrics over time
	 */
	getAverageMetrics(): PerformanceMetrics | null {
		if (this.metricsHistory.length === 0) {
			return null
		}

		const sum = this.metricsHistory.reduce(
			(acc, metrics) => ({
				queryLatencyP50: acc.queryLatencyP50 + metrics.queryLatencyP50,
				queryLatencyP95: acc.queryLatencyP95 + metrics.queryLatencyP95,
				cacheHitRate: acc.cacheHitRate + metrics.cacheHitRate,
				indexingSpeed: acc.indexingSpeed + metrics.indexingSpeed,
				memoryFootprint: acc.memoryFootprint + metrics.memoryFootprint,
				cpuUsage: acc.cpuUsage + metrics.cpuUsage,
			}),
			{
				queryLatencyP50: 0,
				queryLatencyP95: 0,
				cacheHitRate: 0,
				indexingSpeed: 0,
				memoryFootprint: 0,
				cpuUsage: 0,
			},
		)

		const count = this.metricsHistory.length

		return {
			queryLatencyP50: sum.queryLatencyP50 / count,
			queryLatencyP95: sum.queryLatencyP95 / count,
			cacheHitRate: sum.cacheHitRate / count,
			indexingSpeed: sum.indexingSpeed / count,
			memoryFootprint: sum.memoryFootprint / count,
			cpuUsage: sum.cpuUsage / count,
		}
	}

	/**
	 * Check system health and alert on issues
	 */
	private checkHealth(metrics: PerformanceMetrics): void {
		const warnings: string[] = []

		// Check query latency
		if (metrics.queryLatencyP95 > 200) {
			warnings.push(`High query latency: ${metrics.queryLatencyP95}ms (target: <200ms)`)
		}

		// Check memory usage
		if (metrics.memoryFootprint > 500) {
			warnings.push(`High memory usage: ${metrics.memoryFootprint}MB (limit: 500MB)`)
		}

		// Check cache hit rate
		if (metrics.cacheHitRate < 0.3) {
			warnings.push(`Low cache hit rate: ${(metrics.cacheHitRate * 100).toFixed(1)}% (target: >30%)`)
		}

		// Check CPU usage
		if (metrics.cpuUsage > 80) {
			warnings.push(`High CPU usage: ${metrics.cpuUsage}% (limit: 80%)`)
		}

		if (warnings.length > 0) {
			console.warn("Performance warnings:", warnings)
			// TODO: Send notifications to user
		}
	}

	/**
	 * Detect indexing stalls
	 */
	detectIndexingStall(): boolean {
		const stats = this.engine.getIndexingStats()

		// If we have indexed files but speed is 0, it might be stalled
		if (stats.indexedFiles > 0 && stats.indexedFiles < stats.totalFiles) {
			const timeSinceLastIndex = Date.now() - stats.lastIndexTime
			// If no progress for 5 minutes, consider it stalled
			if (timeSinceLastIndex > 300000) {
				return true
			}
		}

		return false
	}

	/**
	 * Get system health status
	 */
	async getHealthStatus(): Promise<{
		status: "healthy" | "degraded" | "unhealthy"
		issues: string[]
		metrics: PerformanceMetrics
	}> {
		const metrics = await this.getCurrentMetrics()
		const issues: string[] = []
		let status: "healthy" | "degraded" | "unhealthy" = "healthy"

		// Check various health indicators
		if (metrics.queryLatencyP95 > 200) {
			issues.push("High query latency")
			status = "degraded"
		}

		if (metrics.queryLatencyP95 > 500) {
			status = "unhealthy"
		}

		if (metrics.memoryFootprint > 500) {
			issues.push("High memory usage")
			status = "degraded"
		}

		if (metrics.memoryFootprint > 1000) {
			status = "unhealthy"
		}

		if (this.detectIndexingStall()) {
			issues.push("Indexing appears to be stalled")
			status = "degraded"
		}

		return {
			status,
			issues,
			metrics,
		}
	}

	/**
	 * Generate performance report
	 */
	async generateReport(): Promise<string> {
		const current = await this.getCurrentMetrics()
		const average = this.getAverageMetrics()
		const stats = this.engine.getIndexingStats()

		let report = "# Context Engine Performance Report\n\n"
		report += "## Current Metrics\n"
		report += `- Query Latency (p50): ${current.queryLatencyP50.toFixed(2)}ms\n`
		report += `- Query Latency (p95): ${current.queryLatencyP95.toFixed(2)}ms\n`
		report += `- Cache Hit Rate: ${(current.cacheHitRate * 100).toFixed(1)}%\n`
		report += `- Indexing Speed: ${current.indexingSpeed.toFixed(2)} files/min\n`
		report += `- Memory Footprint: ${current.memoryFootprint.toFixed(2)} MB\n`
		report += `- CPU Usage: ${current.cpuUsage.toFixed(1)}%\n\n`

		if (average) {
			report += "## Average Metrics (last 100 samples)\n"
			report += `- Avg Query Latency (p50): ${average.queryLatencyP50.toFixed(2)}ms\n`
			report += `- Avg Query Latency (p95): ${average.queryLatencyP95.toFixed(2)}ms\n`
			report += `- Avg Cache Hit Rate: ${(average.cacheHitRate * 100).toFixed(1)}%\n`
			report += `- Avg Memory Footprint: ${average.memoryFootprint.toFixed(2)} MB\n\n`
		}

		report += "## Indexing Statistics\n"
		report += `- Total Files: ${stats.totalFiles}\n`
		report += `- Indexed Files: ${stats.indexedFiles}\n`
		report += `- Total Chunks: ${stats.totalChunks}\n`
		report += `- Failed Files: ${stats.failedFiles.length}\n`
		report += `- Database Size: ${(stats.databaseSize / 1024 / 1024).toFixed(2)} MB\n`

		return report
	}
}
