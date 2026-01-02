// kilocode_change - new file

import { EventEmitter } from "events"

export interface PerformanceMetrics {
	timestamp: number
	cpuUsage: number
	memoryUsage: number
	heapUsed: number
	heapTotal: number
	external: number
	arrayBuffers: number
	indexingProgress: IndexingProgress
	searchPerformance: SearchPerformance
	uiPerformance: UIPerformance
}

export interface IndexingProgress {
	totalFiles: number
	processedFiles: number
	currentFile: string
	startTime: number
	estimatedTimeRemaining: number
	filesPerSecond: number
	errors: number
	isComplete: boolean
}

export interface SearchPerformance {
	averageSearchTime: number
	totalSearches: number
	cacheHitRate: number
	vectorSearchTime: number
	textSearchTime: number
}

export interface UIPerformance {
	renderTime: number
	inputLatency: number
	scrollPerformance: number
	memoryUsage: number
	componentUpdateCount: number
}

export interface ProgressIndicator {
	id: string
	type: "indexing" | "search" | "analysis" | "general"
	progress: number // 0-100
	message: string
	startTime: number
	estimatedCompletion?: number
	cancellable?: boolean
}

/**
 * Comprehensive performance monitoring and progress tracking system
 */
export class PerformanceMonitor extends EventEmitter {
	private metrics: PerformanceMetrics[] = []
	private progressIndicators: Map<string, ProgressIndicator> = new Map()
	private isMonitoring = false
	private monitoringInterval: NodeJS.Timeout | null = null
	private maxMetricsHistory = 1000

	/**
	 * Start performance monitoring
	 */
	startMonitoring(intervalMs: number = 1000): void {
		if (this.isMonitoring) {
			return
		}

		this.isMonitoring = true
		console.log("[PerformanceMonitor] Starting performance monitoring")

		this.monitoringInterval = setInterval(() => {
			this.collectMetrics()
		}, intervalMs)

		// Collect initial metrics
		this.collectMetrics()
	}

	/**
	 * Stop performance monitoring
	 */
	stopMonitoring(): void {
		if (!this.isMonitoring) {
			return
		}

		this.isMonitoring = false
		console.log("[PerformanceMonitor] Stopping performance monitoring")

		if (this.monitoringInterval) {
			clearInterval(this.monitoringInterval)
			this.monitoringInterval = null
		}
	}

	/**
	 * Create a new progress indicator
	 */
	createProgressIndicator(
		id: string,
		type: ProgressIndicator["type"],
		message: string,
		cancellable: boolean = false,
	): void {
		const indicator: ProgressIndicator = {
			id,
			type,
			progress: 0,
			message,
			startTime: Date.now(),
			cancellable,
		}

		this.progressIndicators.set(id, indicator)
		this.emit("progress:created", indicator)
	}

	/**
	 * Update progress indicator
	 */
	updateProgress(id: string, progress: number, message?: string): void {
		const indicator = this.progressIndicators.get(id)
		if (!indicator) {
			return
		}

		indicator.progress = Math.min(100, Math.max(0, progress))
		if (message) {
			indicator.message = message
		}

		// Estimate completion time
		if (progress > 0) {
			const elapsed = Date.now() - indicator.startTime
			const estimatedTotal = elapsed / (progress / 100)
			indicator.estimatedCompletion = indicator.startTime + estimatedTotal
		}

		this.emit("progress:updated", indicator)

		// Remove completed indicators after a delay
		if (progress >= 100) {
			setTimeout(() => {
				this.removeProgressIndicator(id)
			}, 2000)
		}
	}

	/**
	 * Remove progress indicator
	 */
	removeProgressIndicator(id: string): void {
		const indicator = this.progressIndicators.get(id)
		if (indicator) {
			this.progressIndicators.delete(id)
			this.emit("progress:removed", indicator)
		}
	}

	/**
	 * Get current performance metrics
	 */
	getCurrentMetrics(): PerformanceMetrics | null {
		return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null
	}

	/**
	 * Get metrics history
	 */
	getMetricsHistory(limit?: number): PerformanceMetrics[] {
		if (limit) {
			return this.metrics.slice(-limit)
		}
		return [...this.metrics]
	}

	/**
	 * Get all active progress indicators
	 */
	getProgressIndicators(): ProgressIndicator[] {
		return Array.from(this.progressIndicators.values())
	}

	/**
	 * Get performance summary
	 */
	getPerformanceSummary(): any {
		if (this.metrics.length === 0) {
			return null
		}

		const latest = this.getCurrentMetrics()!
		const memoryUsage = process.memoryUsage()

		return {
			timestamp: latest.timestamp,
			memory: {
				heapUsed: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + " MB",
				heapTotal: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2) + " MB",
				external: (memoryUsage.external / 1024 / 1024).toFixed(2) + " MB",
				rss: (memoryUsage.rss / 1024 / 1024).toFixed(2) + " MB",
			},
			indexing: latest.indexingProgress,
			search: latest.searchPerformance,
			ui: latest.uiPerformance,
			activeProgress: this.progressIndicators.size,
		}
	}

	/**
	 * Check if performance thresholds are exceeded
	 */
	checkThresholds(): { warnings: string[]; errors: string[] } {
		const warnings: string[] = []
		const errors: string[] = []

		const metrics = this.getCurrentMetrics()
		if (!metrics) {
			return { warnings, errors }
		}

		// Memory thresholds
		const memoryUsageMB = metrics.memoryUsage / 1024 / 1024
		if (memoryUsageMB > 1024) {
			// > 1GB
			errors.push(`High memory usage: ${memoryUsageMB.toFixed(2)} MB`)
		} else if (memoryUsageMB > 512) {
			// > 512MB
			warnings.push(`Elevated memory usage: ${memoryUsageMB.toFixed(2)} MB`)
		}

		// CPU thresholds
		if (metrics.cpuUsage > 90) {
			errors.push(`High CPU usage: ${metrics.cpuUsage.toFixed(1)}%`)
		} else if (metrics.cpuUsage > 70) {
			warnings.push(`Elevated CPU usage: ${metrics.cpuUsage.toFixed(1)}%`)
		}

		// Search performance thresholds
		if (metrics.searchPerformance.averageSearchTime > 1000) {
			// > 1s
			warnings.push(`Slow search performance: ${metrics.searchPerformance.averageSearchTime.toFixed(0)}ms`)
		}

		// UI performance thresholds
		if (metrics.uiPerformance.renderTime > 16.67) {
			// > 60fps
			warnings.push(`Slow UI rendering: ${metrics.uiPerformance.renderTime.toFixed(2)}ms`)
		}

		return { warnings, errors }
	}

	/**
	 * Clear metrics history
	 */
	clearMetrics(): void {
		this.metrics.length = 0
		console.log("[PerformanceMonitor] Cleared metrics history")
	}

	/**
	 * Export metrics for analysis
	 */
	exportMetrics(): string {
		return JSON.stringify(
			{
				summary: this.getPerformanceSummary(),
				history: this.getMetricsHistory(),
				progress: this.getProgressIndicators(),
				thresholds: this.checkThresholds(),
			},
			null,
			2,
		)
	}

	// Private methods

	private collectMetrics(): void {
		const memUsage = process.memoryUsage()
		const cpuUsage = process.cpuUsage()

		const metrics: PerformanceMetrics = {
			timestamp: Date.now(),
			cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to milliseconds
			memoryUsage: memUsage.rss,
			heapUsed: memUsage.heapUsed,
			heapTotal: memUsage.heapTotal,
			external: memUsage.external,
			arrayBuffers: memUsage.arrayBuffers,
			indexingProgress: this.getIndexingProgress(),
			searchPerformance: this.getSearchPerformance(),
			uiPerformance: this.getUIPerformance(),
		}

		this.metrics.push(metrics)

		// Limit history size
		if (this.metrics.length > this.maxMetricsHistory) {
			this.metrics.shift()
		}

		this.emit("metrics:collected", metrics)

		// Check thresholds
		const thresholds = this.checkThresholds()
		if (thresholds.warnings.length > 0) {
			this.emit("threshold:warning", thresholds.warnings)
		}
		if (thresholds.errors.length > 0) {
			this.emit("threshold:error", thresholds.errors)
		}
	}

	private getIndexingProgress(): IndexingProgress {
		// Find active indexing progress indicators
		const indexingIndicators = Array.from(this.progressIndicators.values()).filter(
			(indicator) => indicator.type === "indexing",
		)

		if (indexingIndicators.length === 0) {
			return {
				totalFiles: 0,
				processedFiles: 0,
				currentFile: "",
				startTime: Date.now(),
				estimatedTimeRemaining: 0,
				filesPerSecond: 0,
				errors: 0,
				isComplete: true,
			}
		}

		const indicator = indexingIndicators[0]
		const elapsed = Date.now() - indicator.startTime
		const filesPerSecond = indicator.progress > 0 ? indicator.progress / 100 / (elapsed / 1000) : 0
		const estimatedTimeRemaining = filesPerSecond > 0 ? (100 - indicator.progress) / 100 / filesPerSecond : 0

		return {
			totalFiles: 100, // Placeholder - would be actual total
			processedFiles: Math.floor(indicator.progress),
			currentFile: indicator.message,
			startTime: indicator.startTime,
			estimatedTimeRemaining,
			filesPerSecond,
			errors: 0, // Placeholder - would track actual errors
			isComplete: indicator.progress >= 100,
		}
	}

	private getSearchPerformance(): SearchPerformance {
		// Placeholder - would integrate with actual search metrics
		return {
			averageSearchTime: 150,
			totalSearches: 0,
			cacheHitRate: 0.85,
			vectorSearchTime: 120,
			textSearchTime: 30,
		}
	}

	private getUIPerformance(): UIPerformance {
		// Placeholder - would integrate with actual UI performance metrics
		return {
			renderTime: 12.5,
			inputLatency: 50,
			scrollPerformance: 60,
			memoryUsage: process.memoryUsage().heapUsed,
			componentUpdateCount: 0,
		}
	}
}

/**
 * Progress indicator component for UI
 */
export class ProgressTracker {
	private monitor: PerformanceMonitor
	private element: HTMLElement | null = null

	constructor(monitor: PerformanceMonitor) {
		this.monitor = monitor
		this.setupEventListeners()
	}

	/**
	 * Attach to DOM element
	 */
	attachToElement(element: HTMLElement): void {
		this.element = element
		this.updateDisplay()
	}

	/**
	 * Detach from DOM element
	 */
	detach(): void {
		this.element = null
	}

	private setupEventListeners(): void {
		this.monitor.on("progress:created", () => this.updateDisplay())
		this.monitor.on("progress:updated", () => this.updateDisplay())
		this.monitor.on("progress:removed", () => this.updateDisplay())
	}

	private updateDisplay(): void {
		if (!this.element) {
			return
		}

		const indicators = this.monitor.getProgressIndicators()

		if (indicators.length === 0) {
			this.element.style.display = "none"
			return
		}

		this.element.style.display = "block"
		this.element.innerHTML = this.renderProgressIndicators(indicators)
	}

	private renderProgressIndicators(indicators: ProgressIndicator[]): string {
		return indicators
			.map(
				(indicator) => `
      <div class="progress-indicator" data-type="${indicator.type}">
        <div class="progress-header">
          <span class="progress-message">${this.escapeHtml(indicator.message)}</span>
          <span class="progress-percentage">${indicator.progress.toFixed(1)}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${indicator.progress}%"></div>
        </div>
        ${
			indicator.estimatedCompletion
				? `
          <div class="progress-eta">
            ETA: ${this.formatTime(indicator.estimatedCompletion - Date.now())}
          </div>
        `
				: ""
		}
      </div>
    `,
			)
			.join("")
	}

	private escapeHtml(text: string): string {
		const div = document.createElement("div")
		div.textContent = text
		return div.innerHTML
	}

	private formatTime(ms: number): string {
		if (ms < 1000) {
			return "< 1s"
		} else if (ms < 60000) {
			return `${Math.floor(ms / 1000)}s`
		} else {
			return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
		}
	}
}

// Global performance monitor instance
export const globalPerformanceMonitor = new PerformanceMonitor()
