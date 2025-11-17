/**
 * Telemetry Client
 * Standalone PostHog client implementation for CLI telemetry
 */

import { PostHog } from "posthog-node"
import * as os from "os"
import { TelemetryEvent, type BaseProperties } from "./events.js"
import { getIdentityManager, type UserIdentity } from "./identity.js"
import { logs } from "../logs.js"

/**
 * Event queue item
 */
interface QueuedEvent {
	event: string
	properties: Record<string, unknown>
	timestamp: number
	retryCount: number
}

/**
 * Telemetry Client configuration
 */
export interface TelemetryConfig {
	enabled: boolean
	apiKey: string
	host: string
	debug?: boolean
	batchSize?: number
	flushInterval?: number
	maxRetries?: number
}

/**
 * Telemetry Client
 * Handles all telemetry operations for the CLI application
 */
export class TelemetryClient {
	private client: PostHog | null = null
	private config: TelemetryConfig
	private identity: UserIdentity | null = null
	private eventQueue: QueuedEvent[] = []
	private flushTimer: NodeJS.Timeout | null = null
	private isShuttingDown = false

	// Performance tracking
	private performanceMetrics = {
		totalCommands: 0,
		totalMessages: 0,
		totalToolExecutions: 0,
		totalApiRequests: 0,
		totalFileOperations: 0,
		commandTimes: [] as number[],
		apiResponseTimes: [] as number[],
		toolExecutionTimes: [] as number[],
	}

	constructor(config: TelemetryConfig) {
		this.config = {
			batchSize: 10,
			flushInterval: 5000, // 5 seconds
			maxRetries: 3,
			...config,
		}

		if (this.config.enabled && this.config.apiKey) {
			this.initializeClient()
		}
	}

	/**
	 * Initialize PostHog client
	 */
	private initializeClient(): void {
		try {
			this.client = new PostHog(this.config.apiKey, {
				host: this.config.host,
				disableGeoip: false,
			})

			// Start flush timer
			this.startFlushTimer()

			if (this.config.debug) {
				logs.debug("Telemetry client initialized", "TelemetryClient")
			}
		} catch (error) {
			logs.error("Failed to initialize telemetry client", "TelemetryClient", { error })
			this.client = null
		}
	}

	/**
	 * Set user identity
	 */
	public setIdentity(identity: UserIdentity): void {
		this.identity = identity

		if (this.config.debug) {
			logs.debug("Identity set for telemetry", "TelemetryClient", {
				cliUserId: identity.cliUserId.substring(0, 8) + "...",
				sessionId: identity.sessionId.substring(0, 8) + "...",
			})
		}
	}

	/**
	 * Update Kilocode user ID
	 */
	public async updateKilocodeUserId(kilocodeToken: string): Promise<void> {
		const identityManager = getIdentityManager()
		await identityManager.updateKilocodeUserId(kilocodeToken)
		this.identity = identityManager.getIdentity()
	}

	/**
	 * Clear Kilocode user ID
	 */
	public clearKilocodeUserId(): void {
		const identityManager = getIdentityManager()
		identityManager.clearKilocodeUserId()
		this.identity = identityManager.getIdentity()
	}

	/**
	 * Capture a telemetry event
	 */
	public capture(event: TelemetryEvent, properties: Record<string, unknown> = {}): void {
		if (!this.config.enabled || !this.client || !this.identity || this.isShuttingDown) {
			return
		}

		try {
			// Build complete properties with base properties
			const completeProperties = {
				...this.getBaseProperties(),
				...properties,
			}

			// Add to queue
			this.eventQueue.push({
				event,
				properties: completeProperties,
				timestamp: Date.now(),
				retryCount: 0,
			})

			// Flush if queue is full
			if (this.eventQueue.length >= (this.config.batchSize || 10)) {
				this.flush()
			}

			if (this.config.debug) {
				logs.debug(`Telemetry event queued: ${event}`, "TelemetryClient", {
					queueSize: this.eventQueue.length,
				})
			}
		} catch (error) {
			logs.error("Failed to capture telemetry event", "TelemetryClient", { error, event })
		}
	}

	/**
	 * Capture an exception
	 */
	public captureException(error: Error, properties: Record<string, unknown> = {}): void {
		this.capture(TelemetryEvent.EXCEPTION_CAUGHT, {
			errorType: error.name,
			errorMessage: error.message,
			errorStack: error.stack,
			isFatal: false,
			...properties,
		})
	}

	/**
	 * Track command execution
	 */
	public trackCommand(commandType: string, executionTime: number, success: boolean): void {
		this.performanceMetrics.totalCommands++
		this.performanceMetrics.commandTimes.push(executionTime)

		this.capture(TelemetryEvent.COMMAND_EXECUTED, {
			commandType,
			executionTime,
			success,
		})
	}

	/**
	 * Track API request
	 */
	public trackApiRequest(
		provider: string,
		model: string,
		responseTime: number,
		tokens?: Record<string, unknown>,
	): void {
		this.performanceMetrics.totalApiRequests++
		this.performanceMetrics.apiResponseTimes.push(responseTime)

		this.capture(TelemetryEvent.API_REQUEST_COMPLETED, {
			provider,
			model,
			responseTime,
			...tokens,
			success: true,
		})
	}

	/**
	 * Track tool execution
	 */
	public trackToolExecution(toolName: string, executionTime: number, success: boolean): void {
		this.performanceMetrics.totalToolExecutions++
		this.performanceMetrics.toolExecutionTimes.push(executionTime)

		this.capture(TelemetryEvent.TOOL_EXECUTED, {
			toolName,
			toolCategory: this.getToolCategory(toolName),
			executionTime,
			success,
		})
	}

	/**
	 * Track file operation
	 */
	public trackFileOperation(): void {
		this.performanceMetrics.totalFileOperations++
	}

	/**
	 * Get performance metrics
	 */
	public getPerformanceMetrics(): Record<string, unknown> {
		const memory = process.memoryUsage()

		return {
			memoryHeapUsed: memory.heapUsed,
			memoryHeapTotal: memory.heapTotal,
			memoryRSS: memory.rss,
			memoryExternal: memory.external,
			totalCommands: this.performanceMetrics.totalCommands,
			totalMessages: this.performanceMetrics.totalMessages,
			totalToolExecutions: this.performanceMetrics.totalToolExecutions,
			totalApiRequests: this.performanceMetrics.totalApiRequests,
			totalFileOperations: this.performanceMetrics.totalFileOperations,
			averageCommandTime: this.calculateAverage(this.performanceMetrics.commandTimes),
			averageApiResponseTime: this.calculateAverage(this.performanceMetrics.apiResponseTimes),
			averageToolExecutionTime: this.calculateAverage(this.performanceMetrics.toolExecutionTimes),
		}
	}

	/**
	 * Send performance metrics
	 */
	public sendPerformanceMetrics(): void {
		const metrics = this.getPerformanceMetrics()
		this.capture(TelemetryEvent.PERFORMANCE_METRICS, metrics)
	}

	/**
	 * Flush queued events
	 */
	public async flush(): Promise<void> {
		if (!this.client || this.eventQueue.length === 0) {
			return
		}

		const eventsToSend = [...this.eventQueue]
		this.eventQueue = []

		for (const queuedEvent of eventsToSend) {
			try {
				const distinctId = this.getDistinctId()

				this.client.capture({
					distinctId,
					event: queuedEvent.event,
					properties: queuedEvent.properties,
					timestamp: new Date(queuedEvent.timestamp),
				})

				if (this.config.debug) {
					logs.debug(`Telemetry event sent: ${queuedEvent.event}`, "TelemetryClient")
				}
			} catch (error) {
				logs.error("Failed to send telemetry event", "TelemetryClient", {
					error,
					event: queuedEvent.event,
				})

				// Retry logic
				if (queuedEvent.retryCount < (this.config.maxRetries || 3)) {
					queuedEvent.retryCount++
					this.eventQueue.push(queuedEvent)
				}
			}
		}
	}

	/**
	 * Shutdown telemetry client
	 */
	public async shutdown(): Promise<void> {
		this.isShuttingDown = true

		// Stop flush timer
		if (this.flushTimer) {
			clearInterval(this.flushTimer)
			this.flushTimer = null
		}

		// Flush remaining events
		await this.flush()

		// Shutdown PostHog client
		if (this.client) {
			await this.client.shutdown()
			this.client = null
		}

		if (this.config.debug) {
			logs.debug("Telemetry client shut down", "TelemetryClient")
		}
	}

	/**
	 * Get base properties for all events
	 */
	private getBaseProperties(): BaseProperties {
		if (!this.identity) {
			throw new Error("Identity not set")
		}

		const baseProps: BaseProperties = {
			cliVersion: this.getCLIVersion(),
			nodeVersion: process.version,
			platform: os.platform(),
			architecture: os.arch(),
			sessionId: this.identity.sessionId,
			sessionDuration: getIdentityManager().getSessionDuration(),
			mode: "code", // Will be overridden by actual mode
			ciMode: false, // Will be overridden by actual CI mode
			cliUserId: this.identity.cliUserId,
		}

		// Only include kilocodeUserId if it exists
		if (this.identity.kilocodeUserId) {
			baseProps.kilocodeUserId = this.identity.kilocodeUserId
		}

		return baseProps
	}

	/**
	 * Get distinct ID for PostHog
	 */
	private getDistinctId(): string {
		return getIdentityManager().getDistinctId()
	}

	/**
	 * Get CLI version
	 */
	private getCLIVersion(): string {
		// This will be populated from package.json
		return "1.0.0"
	}

	/**
	 * Get tool category from tool name
	 */
	private getToolCategory(toolName: string): string {
		const readTools = ["readFile", "listFiles", "searchFiles", "listCodeDefinitionNames"]
		const writeTools = ["editedExistingFile", "appliedDiff", "newFileCreated", "insertContent", "searchAndReplace"]
		const browserTools = ["browser_action"]
		const mcpTools = ["use_mcp_tool", "access_mcp_resource"]

		if (readTools.includes(toolName)) return "read"
		if (writeTools.includes(toolName)) return "write"
		if (browserTools.includes(toolName)) return "browser"
		if (mcpTools.includes(toolName)) return "mcp"

		return "other"
	}

	/**
	 * Calculate average of an array of numbers
	 */
	private calculateAverage(numbers: number[]): number | undefined {
		if (numbers.length === 0) return undefined
		const sum = numbers.reduce((a, b) => a + b, 0)
		return sum / numbers.length
	}

	/**
	 * Start flush timer
	 */
	private startFlushTimer(): void {
		if (this.flushTimer) {
			clearInterval(this.flushTimer)
		}

		this.flushTimer = setInterval(() => {
			this.flush().catch((error) => {
				logs.error("Error during scheduled flush", "TelemetryClient", { error })
			})
		}, this.config.flushInterval || 5000)
	}

	/**
	 * Check if telemetry is enabled
	 */
	public isEnabled(): boolean {
		return this.config.enabled && this.client !== null
	}
}
