// kilocode_change - new file

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"

export interface VirtualScrollItem {
	id: string
	height: number
	data: any
}

export interface VirtualScrollProps {
	items: VirtualScrollItem[]
	itemHeight?: number
	containerHeight: number
	overscan?: number
	renderItem: (item: VirtualScrollItem, index: number) => React.ReactNode
	onScroll?: (scrollTop: number) => void
	className?: string
}

/**
 * High-performance virtual scrolling component for large lists
 */
export const VirtualScroll: React.FC<VirtualScrollProps> = ({
	items,
	itemHeight = 40,
	containerHeight,
	overscan = 5,
	renderItem,
	onScroll,
	className,
}) => {
	const [scrollTop, setScrollTop] = useState(0)
	const scrollElementRef = useRef<HTMLDivElement>(null)

	const visibleRange = useMemo(() => {
		const startIndex = Math.floor(scrollTop / itemHeight)
		const endIndex = Math.min(items.length - 1, startIndex + Math.ceil(containerHeight / itemHeight) + overscan)

		return {
			start: Math.max(0, startIndex - overscan),
			end: endIndex,
		}
	}, [scrollTop, itemHeight, containerHeight, overscan, items.length])

	const visibleItems = useMemo(() => {
		return items.slice(visibleRange.start, visibleRange.end + 1)
	}, [items, visibleRange])

	const totalHeight = items.length * itemHeight

	const handleScroll = useCallback(
		(e: React.UIEvent<HTMLDivElement>) => {
			const newScrollTop = e.currentTarget.scrollTop
			setScrollTop(newScrollTop)
			onScroll?.(newScrollTop)
		},
		[onScroll],
	)

	return (
		<div
			ref={scrollElementRef}
			className={className}
			style={{
				height: containerHeight,
				overflow: "auto",
			}}
			onScroll={handleScroll}>
			<div style={{ height: totalHeight, position: "relative" }}>
				{visibleItems.map((item, index) => {
					const actualIndex = visibleRange.start + index
					return (
						<div
							key={item.id}
							style={{
								position: "absolute",
								top: actualIndex * itemHeight,
								height: itemHeight,
								width: "100%",
							}}>
							{renderItem(item, actualIndex)}
						</div>
					)
				})}
			</div>
		</div>
	)
}

export interface ThrottledInputProps {
	value: string
	onChange: (value: string) => void
	delay?: number
	placeholder?: string
	className?: string
	disabled?: boolean
}

/**
 * Input component with built-in throttling to prevent excessive requests
 */
export const ThrottledInput: React.FC<ThrottledInputProps> = ({
	value,
	onChange,
	delay = 300,
	placeholder,
	className,
	disabled,
}) => {
	const [localValue, setLocalValue] = useState(value)
	const timeoutRef = useRef<NodeJS.Timeout>()

	useEffect(() => {
		setLocalValue(value)
	}, [value])

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const newValue = e.target.value
			setLocalValue(newValue)

			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}

			timeoutRef.current = setTimeout(() => {
				onChange(newValue)
			}, delay)
		},
		[onChange, delay],
	)

	useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
		}
	}, [])

	return (
		<input
			type="text"
			value={localValue}
			onChange={handleChange}
			placeholder={placeholder}
			className={className}
			disabled={disabled}
		/>
	)
}

export interface RequestThrottlerOptions {
	maxRequests: number
	windowMs: number
	onThrottle?: (queueSize: number) => void
}

/**
 * Request throttler to prevent API overload
 */
export class RequestThrottler {
	private queue: Array<{
		id: string
		execute: () => Promise<any>
		resolve: (value: any) => void
		reject: (error: Error) => void
	}> = []
	private timestamps: number[] = []
	private options: RequestThrottlerOptions
	private processing = false

	constructor(options: RequestThrottlerOptions) {
		this.options = options
	}

	/**
	 * Execute a function with throttling
	 */
	async execute<T>(id: string, fn: () => Promise<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			this.queue.push({ id, execute: fn, resolve, reject })
			this.processQueue()
		})
	}

	/**
	 * Get current queue status
	 */
	getStatus(): { queueSize: number; isProcessing: boolean; recentRequests: number } {
		return {
			queueSize: this.queue.length,
			isProcessing: this.processing,
			recentRequests: this.timestamps.length,
		}
	}

	/**
	 * Clear the queue
	 */
	clearQueue(): void {
		// Reject all pending requests
		for (const item of this.queue) {
			item.reject(new Error("Request cancelled due to queue clear"))
		}
		this.queue.length = 0
	}

	private async processQueue(): Promise<void> {
		if (this.processing || this.queue.length === 0) {
			return
		}

		this.processing = true

		while (this.queue.length > 0) {
			// Clean old timestamps
			const now = Date.now()
			this.timestamps = this.timestamps.filter((timestamp) => now - timestamp < this.options.windowMs)

			// Check if we can make a request
			if (this.timestamps.length < this.options.maxRequests) {
				const item = this.queue.shift()!

				try {
					const result = await item.execute()
					item.resolve(result)
					this.timestamps.push(now)
				} catch (error) {
					item.reject(error as Error)
				}
			} else {
				// Wait for the oldest request to expire
				const oldestTimestamp = Math.min(...this.timestamps)
				const waitTime = this.options.windowMs - (now - oldestTimestamp)

				if (waitTime > 0) {
					await new Promise((resolve) => setTimeout(resolve, waitTime))
				}
			}

			// Notify about throttling
			if (this.queue.length > 0) {
				this.options.onThrottle?.(this.queue.length)
			}
		}

		this.processing = false
	}
}

export interface PerformanceMonitor {
	trackRender: (componentName: string) => () => void
	trackRequest: (url: string) => () => void
	getMetrics: () => PerformanceMetrics
}

export interface PerformanceMetrics {
	renderTimes: Record<string, number[]>
	requestTimes: Record<string, number[]>
	averageRenderTime: number
	averageRequestTime: number
	totalRenders: number
	totalRequests: number
}

/**
 * Performance monitoring utility for UI optimization
 */
export class UIPerformanceMonitor implements PerformanceMonitor {
	private renderTimes: Record<string, number[]> = {}
	private requestTimes: Record<string, number[]> = {}
	private renderStartTimes: Map<string, number> = new Map()
	private requestStartTimes: Map<string, number> = new Map()

	trackRender(componentName: string): () => void {
		const startTime = performance.now()
		this.renderStartTimes.set(componentName, startTime)

		return () => {
			const endTime = performance.now()
			const duration = endTime - startTime

			if (!this.renderTimes[componentName]) {
				this.renderTimes[componentName] = []
			}
			this.renderTimes[componentName].push(duration)

			this.renderStartTimes.delete(componentName)

			// Warn about slow renders
			if (duration > 16.67) {
				// 60fps threshold
				console.warn(`[Performance] Slow render detected: ${componentName} took ${duration.toFixed(2)}ms`)
			}
		}
	}

	trackRequest(url: string): () => void {
		const startTime = performance.now()
		this.requestStartTimes.set(url, startTime)

		return () => {
			const endTime = performance.now()
			const duration = endTime - startTime

			if (!this.requestTimes[url]) {
				this.requestTimes[url] = []
			}
			this.requestTimes[url].push(duration)

			this.requestStartTimes.delete(url)
		}
	}

	getMetrics(): PerformanceMetrics {
		const allRenderTimes = Object.values(this.renderTimes).flat()
		const allRequestTimes = Object.values(this.requestTimes).flat()

		const averageRenderTime =
			allRenderTimes.length > 0 ? allRenderTimes.reduce((sum, time) => sum + time, 0) / allRenderTimes.length : 0

		const averageRequestTime =
			allRequestTimes.length > 0
				? allRequestTimes.reduce((sum, time) => sum + time, 0) / allRequestTimes.length
				: 0

		return {
			renderTimes: { ...this.renderTimes },
			requestTimes: { ...this.requestTimes },
			averageRenderTime,
			averageRequestTime,
			totalRenders: allRenderTimes.length,
			totalRequests: allRequestTimes.length,
		}
	}

	clearMetrics(): void {
		this.renderTimes = {}
		this.requestTimes = {}
		this.renderStartTimes.clear()
		this.requestStartTimes.clear()
	}
}

/**
 * Hook for performance monitoring
 */
export function usePerformanceMonitor(componentName: string) {
	const monitor = useMemo(() => new UIPerformanceMonitor(), [])

	useEffect(() => {
		const stopTracking = monitor.trackRender(componentName)
		return stopTracking
	}, [componentName, monitor])

	return monitor
}

/**
 * Hook for throttled API requests
 */
export function useThrottledRequests(options: RequestThrottlerOptions) {
	const throttler = useMemo(() => new RequestThrottler(options), [options])

	const executeRequest = useCallback(
		<T,>(id: string, fn: () => Promise<T>) => {
			return throttler.execute(id, fn)
		},
		[throttler],
	)

	const getStatus = useCallback(() => throttler.getStatus(), [throttler])

	const clearQueue = useCallback(() => throttler.clearQueue(), [throttler])

	return {
		executeRequest,
		getStatus,
		clearQueue,
	}
}

/**
 * Component that automatically optimizes renders based on performance
 */
export const PerformanceOptimized: React.FC<{
	children: React.ReactNode
	fallback?: React.ReactNode
	threshold?: number
}> = ({ children, fallback, threshold = 16.67 }) => {
	const [isSlow, setIsSlow] = useState(false)
	const monitor = usePerformanceMonitor("PerformanceOptimized")

	useEffect(() => {
		const metrics = monitor.getMetrics()
		if (metrics.averageRenderTime > threshold) {
			setIsSlow(true)
			console.warn("[Performance] Component render threshold exceeded, switching to optimized mode")
		}
	}, [monitor, threshold])

	if (isSlow && fallback) {
		return <>{fallback}</>
	}

	return <>{children}</>
}
