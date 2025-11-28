/**
 * Telemetry Service
 * Singleton service that manages telemetry lifecycle and provides high-level tracking methods
 */

import { TelemetryClient, type TelemetryConfig } from "./TelemetryClient.js"
import { getIdentityManager } from "./identity.js"
import { TelemetryEvent } from "./events.js"
import { logs } from "../logs.js"
import type { CLIConfig } from "../../config/types.js"
import { KILOCODE_POSTHOG_API_KEY } from "../../constants/telemetry.js"

/**
 * Telemetry Service
 * Provides a high-level API for tracking telemetry events throughout the CLI
 */
export class TelemetryService {
	private static instance: TelemetryService | null = null
	private client: TelemetryClient | null = null
	private isInitialized = false
	private sessionStartTime = 0
	private currentMode = "code"
	private currentCIMode = false
	private currentWorkspace = ""

	private constructor() {
		// Private constructor for singleton
	}

	/**
	 * Get singleton instance
	 */
	public static getInstance(): TelemetryService {
		if (!TelemetryService.instance) {
			TelemetryService.instance = new TelemetryService()
		}
		return TelemetryService.instance
	}

	/**
	 * Initialize telemetry service
	 */
	public async initialize(
		config: CLIConfig,
		options: { workspace: string; mode: string; ciMode: boolean },
	): Promise<void> {
		if (this.isInitialized) {
			logs.warn("Telemetry service already initialized", "TelemetryService")
			return
		}

		try {
			// Store session info
			this.sessionStartTime = Date.now()
			this.currentMode = options.mode
			this.currentCIMode = options.ciMode
			this.currentWorkspace = options.workspace

			// Check if telemetry is enabled
			if (!config.telemetry) {
				logs.info("Telemetry is disabled in config", "TelemetryService")
				this.isInitialized = true
				return
			}

			// Get API key from environment
			const apiKey = KILOCODE_POSTHOG_API_KEY
			if (!apiKey) {
				logs.warn("KILOCODE_POSTHOG_API_KEY not set, telemetry disabled", "TelemetryService")
				this.isInitialized = true
				return
			}

			// Initialize identity
			const identityManager = getIdentityManager()
			const identity = await identityManager.initialize()

			// Update Kilocode user ID if token is available
			const provider = config.providers.find((p) => p.id === config.provider)
			if (provider && provider.kilocodeToken && typeof provider.kilocodeToken === "string") {
				await identityManager.updateKilocodeUserId(provider.kilocodeToken)
			}

			// Create telemetry client
			const telemetryConfig: TelemetryConfig = {
				enabled: true,
				apiKey,
				host: "https://us.i.posthog.com",
				debug: process.env.KILO_TELEMETRY_DEBUG === "true",
			}

			this.client = new TelemetryClient(telemetryConfig)
			this.client.setIdentity(identity)

			this.isInitialized = true

			// Track session start
			this.trackSessionStart(options)

			logs.info("Telemetry service initialized", "TelemetryService")
		} catch (error) {
			logs.error("Failed to initialize telemetry service", "TelemetryService", { error })
			this.isInitialized = true // Mark as initialized even on error to prevent retries
		}
	}

	/**
	 * Shutdown telemetry service
	 */
	public async shutdown(): Promise<void> {
		if (!this.isInitialized || !this.client) {
			return
		}

		try {
			// Track session end
			this.trackSessionEnd()

			// Send final performance metrics
			this.client.sendPerformanceMetrics()

			// Shutdown client
			await this.client.shutdown()

			logs.info("Telemetry service shut down", "TelemetryService")
		} catch (error) {
			logs.error("Error shutting down telemetry service", "TelemetryService", { error })
		}
	}

	/**
	 * Update mode
	 */
	public setMode(mode: string): void {
		this.currentMode = mode
	}

	/**
	 * Update CI mode
	 */
	public setCIMode(ciMode: boolean): void {
		this.currentCIMode = ciMode
	}

	/**
	 * Update Kilocode user ID
	 */
	public async updateKilocodeUserId(kilocodeToken: string): Promise<void> {
		if (this.client) {
			await this.client.updateKilocodeUserId(kilocodeToken)
		}
	}

	/**
	 * Clear Kilocode user ID
	 */
	public clearKilocodeUserId(): void {
		if (this.client) {
			this.client.clearKilocodeUserId()
		}
	}

	// ============================================================================
	// Session Tracking
	// ============================================================================

	private trackSessionStart(options: { workspace: string; mode: string; ciMode: boolean }): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.SESSION_STARTED, {
			mode: options.mode,
			ciMode: options.ciMode,
			initialMode: options.mode,
			initialWorkspace: this.anonymizeWorkspace(options.workspace),
			hasPrompt: false, // Will be updated by CLI
			hasTimeout: false,
		})
	}

	private trackSessionEnd(): void {
		if (!this.client) return

		const sessionDuration = Date.now() - this.sessionStartTime

		this.client.capture(TelemetryEvent.SESSION_ENDED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			sessionDuration,
		})
	}

	// ============================================================================
	// Command Tracking
	// ============================================================================

	public trackCommandExecuted(commandType: string, args: string[], executionTime: number, success: boolean): void {
		if (!this.client) return

		this.client.trackCommand(commandType, executionTime, success)
		this.client.capture(TelemetryEvent.COMMAND_EXECUTED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			commandType,
			commandArgs: args,
			executionTime,
			success,
		})
	}

	public trackCommandFailed(commandType: string, errorMessage: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.COMMAND_FAILED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			commandType,
			errorMessage,
		})
	}

	// ============================================================================
	// Message Tracking
	// ============================================================================

	public trackUserMessageSent(messageLength: number, hasImages: boolean, isFollowup: boolean, taskId?: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.USER_MESSAGE_SENT, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			messageLength,
			hasImages,
			imageCount: hasImages ? 1 : 0,
			isFollowup,
			taskId,
		})
	}

	public trackAssistantMessageReceived(messageLength: number, taskId?: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.ASSISTANT_MESSAGE_RECEIVED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			messageLength,
			isFollowup: false,
			hasImages: false,
			taskId,
		})
	}

	// ============================================================================
	// Task Tracking
	// ============================================================================

	public trackTaskCreated(taskId: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.TASK_CREATED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			taskId,
		})
	}

	public trackTaskCompleted(taskId: string, duration: number, stats: Record<string, unknown>): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.TASK_COMPLETED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			taskId,
			taskDuration: duration,
			...stats,
		})
	}

	public trackTaskFailed(taskId: string, errorMessage: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.TASK_FAILED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			taskId,
			errorMessage,
		})
	}

	public trackTaskCancelled(taskId: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.TASK_CANCELLED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			taskId,
		})
	}

	// ============================================================================
	// Configuration Tracking
	// ============================================================================

	public trackConfigLoaded(config: CLIConfig): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.CONFIG_LOADED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			configVersion: config.version,
			providerCount: config.providers.length,
			selectedProvider: config.provider,
			telemetryEnabled: config.telemetry,
			autoApprovalEnabled: config.autoApproval?.enabled ?? false,
		})
	}

	public trackConfigSaved(config: CLIConfig): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.CONFIG_SAVED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			configVersion: config.version,
			providerCount: config.providers.length,
			selectedProvider: config.provider,
			telemetryEnabled: config.telemetry,
			autoApprovalEnabled: config.autoApproval?.enabled ?? false,
		})
	}

	public trackProviderChanged(previousProvider: string, newProvider: string, newModel?: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.PROVIDER_CHANGED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			previousProvider,
			newProvider,
			newModel,
		})
	}

	public trackModeChanged(previousMode: string, newMode: string): void {
		if (!this.client) return

		this.currentMode = newMode

		this.client.capture(TelemetryEvent.MODE_CHANGED, {
			mode: newMode,
			ciMode: this.currentCIMode,
			previousMode,
		})
	}

	public trackThemeChanged(previousTheme: string, newTheme: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.THEME_CHANGED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			previousTheme,
			newTheme,
		})
	}

	// ============================================================================
	// Tool Tracking
	// ============================================================================

	public trackToolExecuted(
		toolName: string,
		executionTime: number,
		success: boolean,
		metadata?: Record<string, unknown>,
	): void {
		if (!this.client) return

		this.client.trackToolExecution(toolName, executionTime, success)
		this.client.capture(TelemetryEvent.TOOL_EXECUTED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			toolName,
			toolCategory: this.getToolCategory(toolName),
			executionTime,
			success,
			...metadata,
		})
	}

	// ============================================================================
	// Approval Tracking
	// ============================================================================

	public trackApprovalRequested(approvalType: string, toolName?: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.APPROVAL_REQUESTED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			approvalType,
			toolName,
			autoApproved: false,
			autoRejected: false,
		})
	}

	public trackApprovalAutoApproved(approvalType: string, toolName?: string, responseTime?: number): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.APPROVAL_AUTO_APPROVED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			approvalType,
			toolName,
			autoApproved: true,
			autoRejected: false,
			responseTime,
		})
	}

	public trackApprovalAutoRejected(approvalType: string, toolName?: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.APPROVAL_AUTO_REJECTED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			approvalType,
			toolName,
			autoApproved: false,
			autoRejected: true,
		})
	}

	public trackApprovalManualApproved(approvalType: string, toolName?: string, responseTime?: number): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.APPROVAL_MANUAL_APPROVED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			approvalType,
			toolName,
			autoApproved: false,
			autoRejected: false,
			responseTime,
		})
	}

	public trackApprovalManualRejected(approvalType: string, toolName?: string, responseTime?: number): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.APPROVAL_MANUAL_REJECTED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			approvalType,
			toolName,
			autoApproved: false,
			autoRejected: false,
			responseTime,
		})
	}

	// ============================================================================
	// Error Tracking
	// ============================================================================

	public trackError(errorType: string, errorMessage: string, errorStack?: string, isFatal = false): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.ERROR_OCCURRED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			errorType,
			errorMessage,
			errorStack,
			isFatal,
		})
	}

	public trackException(error: Error, context?: string, isFatal = false): void {
		if (!this.client) return

		this.client.captureException(error, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			errorContext: context,
			isFatal,
		})
	}

	// ============================================================================
	// Performance Tracking
	// ============================================================================

	public trackApiRequest(
		provider: string,
		model: string,
		responseTime: number,
		tokens?: Record<string, unknown>,
	): void {
		if (!this.client) return

		this.client.trackApiRequest(provider, model, responseTime, tokens)
	}

	public sendPerformanceMetrics(): void {
		if (!this.client) return

		this.client.sendPerformanceMetrics()
	}

	// ============================================================================
	// Extension Communication Tracking
	// ============================================================================

	public trackExtensionInitialized(success: boolean): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.EXTENSION_INITIALIZED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			success,
		})
	}

	public trackExtensionMessageSent(messageType: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.EXTENSION_MESSAGE_SENT, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			messageType,
			direction: "sent" as const,
			success: true,
		})
	}

	public trackExtensionMessageReceived(messageType: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.EXTENSION_MESSAGE_RECEIVED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			messageType,
			direction: "received" as const,
			success: true,
		})
	}

	// ============================================================================
	// CI Mode Tracking
	// ============================================================================

	public trackCIModeStarted(promptLength: number, timeoutSeconds?: number): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.CI_MODE_STARTED, {
			mode: this.currentMode,
			ciMode: true,
			promptLength,
			timeoutSeconds,
		})
	}

	public trackCIModeCompleted(stats: Record<string, unknown>): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.CI_MODE_COMPLETED, {
			mode: this.currentMode,
			ciMode: true,
			...stats,
		})
	}

	public trackCIModeTimeout(): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.CI_MODE_TIMEOUT, {
			mode: this.currentMode,
			ciMode: true,
		})
	}

	// ============================================================================
	// Parallel Mode Tracking
	// ============================================================================

	public parallelModeStart = 0

	public trackParallelModeStarted(isExistingBranch: boolean, promptLength: number, timeoutSeconds?: number): void {
		if (!this.client) return

		this.parallelModeStart = Date.now()

		this.client.capture(TelemetryEvent.PARALLEL_MODE_STARTED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			isExistingBranch,
			promptLength,
			timeoutSeconds,
		})
	}

	public trackParallelModeCompleted(): void {
		if (!this.client) return

		const duration = Date.now() - this.parallelModeStart

		this.client.capture(TelemetryEvent.PARALLEL_MODE_COMPLETED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			duration,
		})
	}

	public trackParallelModeErrored(errorMessage: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.PARALLEL_MODE_ERRORED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			errorMessage,
		})
	}

	// ============================================================================
	// MCP Tracking
	// ============================================================================

	public trackMCPToolUsed(
		serverName: string,
		toolName: string,
		executionTime: number,
		success: boolean,
		errorMessage?: string,
	): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.MCP_TOOL_USED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			serverName,
			toolName,
			executionTime,
			success,
			errorMessage,
		})
	}

	public trackMCPResourceAccessed(
		serverName: string,
		resourceUri: string,
		executionTime: number,
		success: boolean,
		errorMessage?: string,
	): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.MCP_RESOURCE_ACCESSED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			serverName,
			resourceUri,
			executionTime,
			success,
			errorMessage,
		})
	}

	// ============================================================================
	// Authentication Tracking
	// ============================================================================

	public trackAuthTokenUpdated(success: boolean): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.AUTH_TOKEN_UPDATED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			authMethod: "kilocode_token",
			success,
		})
	}

	public trackAuthFailed(errorMessage: string): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.AUTH_FAILED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			authMethod: "kilocode_token",
			success: false,
			errorMessage,
		})
	}

	// ============================================================================
	// Feature Usage Tracking
	// ============================================================================

	public trackFeatureUsed(featureName: string, usageCount: number, firstUsed: boolean): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.FEATURE_USED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			featureName,
			usageCount,
			firstUsed,
		})
	}

	// ============================================================================
	// Workflow Pattern Tracking
	// ============================================================================

	public trackWorkflowPattern(
		patternType: string,
		commandSequence: string[],
		frequency: number,
		duration: number,
	): void {
		if (!this.client) return

		this.client.capture(TelemetryEvent.WORKFLOW_PATTERN_DETECTED, {
			mode: this.currentMode,
			ciMode: this.currentCIMode,
			patternType,
			commandSequence,
			frequency,
			duration,
		})
	}

	// ============================================================================
	// Helper Methods
	// ============================================================================

	private anonymizeWorkspace(workspace: string): string {
		// Return a hash of the workspace path for privacy
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const crypto = require("crypto")
		return crypto.createHash("sha256").update(workspace).digest("hex").substring(0, 16)
	}

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
	 * Check if telemetry is enabled
	 */
	public isEnabled(): boolean {
		return this.client?.isEnabled() ?? false
	}
}

/**
 * Get the singleton telemetry service instance
 */
export function getTelemetryService(): TelemetryService {
	return TelemetryService.getInstance()
}
