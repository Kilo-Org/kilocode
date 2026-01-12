/**
 * AI Features Performance Optimization
 *
 * Performance optimization strategies for large codebases:
 * - Incremental indexing
 * - Intelligent caching
 * - Background processing
 * - Resource management
 *
 * kilocode_change - new file
 */

import { EventEmitter } from "events"

/**
 * Optimization configuration
 */
export interface OptimizationConfig {
	enableIncrementalIndexing: boolean
	enableCaching: boolean
	enableBackgroundProcessing: boolean
	maxCacheSize: number
	cacheTTL: number
	maxConcurrentOperations: number
	memoryThreshold: number
}

/**
 * Cache entry
 */
export interface CacheEntry<T> {
	key: string
	value: T
	timestamp: number
	accessCount: number
	size: number
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
	cacheHitRate: number
	cacheMissRate: number
	averageResponseTime: number
	memoryUsage: number
	operationsQueued: number
	operationsCompleted: number
}

/**
 * AI Performance Optimizer
 */
export class AIPerformanceOptimizer extends EventEmitter {
	private config: OptimizationConfig
	private cache: Map<string, CacheEntry<any>> = new Map()
	private operationQueue: Array<() => Promise<any>> = []
	private activeOperations: number = 0
	private metrics: PerformanceMetrics = {
		cacheHitRate: 0,
		cacheMissRate: 0,
		averageResponseTime: 0,
		memoryUsage: 0,
		operationsQueued: 0,
		operationsCompleted: 0,
	}
	private totalCacheHits: number = 0
	private totalCacheMisses: number = 0
	private responseTimes: number[] = []

	constructor(config?: Partial<OptimizationConfig>) {
		super()
		this.config = this.getDefaultConfig()
		if (config) {
			this.updateConfig(config)
		}
		this.startBackgroundTasks()
	}

	/**
	 * Get cached value
	 */
	get<T>(key: string): T | null {
		if (!this.config.enableCaching) {
			return null
		}

		const entry = this.cache.get(key)
		if (!entry) {
			this.totalCacheMisses++
			this.updateMetrics()
			return null
		}

		// Check if entry is expired
		const now = Date.now()
		if (now - entry.timestamp > this.config.cacheTTL) {
			this.cache.delete(key)
			this.totalCacheMisses++
			this.updateMetrics()
			return null
		}

		// Update access count
		entry.accessCount++
		this.totalCacheHits++
		this.updateMetrics()
		return entry.value as T
	}

	/**
	 * Set cached value
	 */
	set<T>(key: string, value: T, size: number = 1): void {
		if (!this.config.enableCaching) {
			return
		}

		// Check cache size limit
		const currentSize = this.getCacheSize()
		if (currentSize + size > this.config.maxCacheSize) {
			this.evictLRUEntries(size)
		}

		this.cache.set(key, {
			key,
			value,
			timestamp: Date.now(),
			accessCount: 0,
			size,
		})
	}

	/**
	 * Clear cache
	 */
	clearCache(): void {
		this.cache.clear()
		this.totalCacheHits = 0
		this.totalCacheMisses = 0
		this.updateMetrics()
		this.emit("cache-cleared")
	}

	/**
	 * Execute operation with optimization
	 */
	async execute<T>(
		key: string,
		operation: () => Promise<T>,
		cacheResult: boolean = true,
		size: number = 1,
	): Promise<T> {
		// Check cache first
		if (cacheResult) {
			const cached = this.get<T>(key)
			if (cached !== null) {
				return cached
			}
		}

		// Queue operation if background processing is enabled
		if (this.config.enableBackgroundProcessing && this.activeOperations >= this.config.maxConcurrentOperations) {
			return new Promise((resolve, reject) => {
				this.operationQueue.push(async () => {
					try {
						const result = await this.executeDirect(key, operation, cacheResult, size)
						resolve(result)
					} catch (error) {
						reject(error)
					}
				})
				this.metrics.operationsQueued = this.operationQueue.length
				this.updateMetrics()
			})
		}

		return this.executeDirect(key, operation, cacheResult, size)
	}

	/**
	 * Execute operation directly
	 */
	private async executeDirect<T>(
		key: string,
		operation: () => Promise<T>,
		cacheResult: boolean,
		size: number,
	): Promise<T> {
		const startTime = Date.now()
		this.activeOperations++

		try {
			const result = await operation()
			const duration = Date.now() - startTime

			// Cache result if enabled
			if (cacheResult) {
				this.set(key, result, size)
			}

			// Track response time
			this.responseTimes.push(duration)
			if (this.responseTimes.length > 100) {
				this.responseTimes.shift()
			}

			this.metrics.operationsCompleted++
			this.updateMetrics()
			this.emit("operation-completed", { duration, success: true })

			return result
		} catch (error) {
			const duration = Date.now() - startTime
			this.emit("operation-completed", { duration, success: false, error })
			throw error
		} finally {
			this.activeOperations--
			this.processQueue()
		}
	}

	/**
	 * Process queued operations
	 */
	private processQueue(): void {
		if (this.operationQueue.length === 0) {
			return
		}

		if (this.activeOperations < this.config.maxConcurrentOperations) {
			const operation = this.operationQueue.shift()
			if (operation) {
				this.metrics.operationsQueued = this.operationQueue.length
				this.updateMetrics()
				operation().catch((error) => {
					this.emit("operation-error", error)
				})
			}
		}
	}

	/**
	 * Evict least recently used cache entries
	 */
	private evictLRUEntries(requiredSpace: number): void {
		const entries = Array.from(this.cache.values()).sort((a, b) => a.accessCount - b.accessCount)

		let freedSpace = 0
		for (const entry of entries) {
			if (freedSpace >= requiredSpace) {
				break
			}
			this.cache.delete(entry.key)
			freedSpace += entry.size
		}

		this.emit("cache-evicted", { freedSpace })
	}

	/**
	 * Get current cache size
	 */
	private getCacheSize(): number {
		return Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.size, 0)
	}

	/**
	 * Update performance metrics
	 */
	private updateMetrics(): void {
		const totalRequests = this.totalCacheHits + this.totalCacheMisses
		this.metrics.cacheHitRate = totalRequests > 0 ? (this.totalCacheHits / totalRequests) * 100 : 0
		this.metrics.cacheMissRate = totalRequests > 0 ? (this.totalCacheMisses / totalRequests) * 100 : 0

		if (this.responseTimes.length > 0) {
			const sum = this.responseTimes.reduce((a, b) => a + b, 0)
			this.metrics.averageResponseTime = sum / this.responseTimes.length
		}

		this.metrics.memoryUsage = this.getCacheSize()
	}

	/**
	 * Start background tasks
	 */
	private startBackgroundTasks(): void {
		// Periodic cache cleanup
		setInterval(() => {
			this.cleanupExpiredEntries()
		}, 60000) // Every minute

		// Process queue periodically
		setInterval(() => {
			this.processQueue()
		}, 100) // Every 100ms
	}

	/**
	 * Clean up expired cache entries
	 */
	private cleanupExpiredEntries(): void {
		const now = Date.now()
		let cleaned = 0

		for (const [key, entry] of this.cache.entries()) {
			if (now - entry.timestamp > this.config.cacheTTL) {
				this.cache.delete(key)
				cleaned++
			}
		}

		if (cleaned > 0) {
			this.emit("cache-cleanup", { entriesCleaned: cleaned })
		}
	}

	/**
	 * Get performance metrics
	 */
	getMetrics(): PerformanceMetrics {
		return { ...this.metrics }
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): {
		size: number
		entryCount: number
		hitRate: number
		missRate: number
	} {
		return {
			size: this.getCacheSize(),
			entryCount: this.cache.size,
			hitRate: this.metrics.cacheHitRate,
			missRate: this.metrics.cacheMissRate,
		}
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<OptimizationConfig>): void {
		this.config = { ...this.config, ...config }
		this.emit("config-updated", this.config)
	}

	/**
	 * Get configuration
	 */
	getConfig(): OptimizationConfig {
		return { ...this.config }
	}

	/**
	 * Get default configuration
	 */
	private getDefaultConfig(): OptimizationConfig {
		return {
			enableIncrementalIndexing: true,
			enableCaching: true,
			enableBackgroundProcessing: true,
			maxCacheSize: 100 * 1024 * 1024, // 100MB
			cacheTTL: 30 * 60 * 1000, // 30 minutes
			maxConcurrentOperations: 5,
			memoryThreshold: 500 * 1024 * 1024, // 500MB
		}
	}

	/**
	 * Dispose optimizer
	 */
	dispose(): void {
		this.clearCache()
		this.operationQueue = []
		this.removeAllListeners()
	}
}

/**
 * Create performance optimizer instance
 */
export function createPerformanceOptimizer(config?: Partial<OptimizationConfig>): AIPerformanceOptimizer {
	return new AIPerformanceOptimizer(config)
}

/**
 * Execute with caching
 */
export async function withCache<T>(
	key: string,
	operation: () => Promise<T>,
	optimizer?: AIPerformanceOptimizer,
): Promise<T> {
	const opt = optimizer || createPerformanceOptimizer()
	return opt.execute(key, operation, true)
}

/**
 * Execute without caching
 */
export async function withoutCache<T>(operation: () => Promise<T>, optimizer?: AIPerformanceOptimizer): Promise<T> {
	const opt = optimizer || createPerformanceOptimizer()
	return opt.execute("no-cache-" + Date.now(), operation, false)
}
