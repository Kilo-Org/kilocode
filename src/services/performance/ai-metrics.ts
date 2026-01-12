/**
 * AI Features Metrics Collection
 *
 * Collects and analyzes performance metrics for AI features:
 * - Enhanced Chat with Source Discovery
 * - Next Edit Guidance System
 * - Context-Aware Intelligent Completions
 * - Slack Integration
 *
 * kilocode_change - new file
 */

import { Logger } from "../error-handler"

/**
 * AI-specific metric types
 */
export type AIMetricType =
	| "chat_request"
	| "chat_citation_generation"
	| "chat_context_search"
	| "edit_plan_generation"
	| "edit_step_execution"
	| "ast_analysis"
	| "completion_generation"
	| "semantic_search"
	| "nl_to_code_translation"
	| "slack_message_share"
	| "slack_oauth_flow"
	| "vector_embedding"
	| "documentation_indexing"

/**
 * AI feature performance metrics
 */
export interface AIMetrics {
	operationId: string
	operationType: AIMetricType
	aiFeature: "chat" | "edit_guidance" | "completions" | "slack_integration"
	aiMetricType: AIMetricType
	startTime: number
	endTime?: number
	duration?: number
	memoryUsageBefore?: number
	memoryUsageAfter?: number
	success: boolean
	error?: string

	// Chat-specific metrics
	chatMetrics?: {
		messageLength: number
		citationCount: number
		contextFilesCount: number
		responseLength: number
	}

	// Edit guidance metrics
	editMetrics?: {
		planStepCount: number
		relatedFilesCount: number
		astNodesAnalyzed: number
		dependenciesDetected: number
	}

	// Completions metrics
	completionMetrics?: {
		completionLength: number
		confidenceScore: number
		semanticMatches: number
		contextFilesScanned: number
	}

	// Slack metrics
	slackMetrics?: {
		messageSize: number
		channelCount: number
		attachmentCount: number
	}

	// Vector/embedding metrics
	vectorMetrics?: {
		embeddingDimension: number
		similarityScore: number
		indexSize: number
	}
}

/**
 * AI feature performance report
 */
export interface AIPerformanceReport {
	timeRange: { start: Date; end: Date }

	// Overall stats
	totalOperations: number
	successfulOperations: number
	failedOperationsCount: number
	successRate: number

	// Feature-specific stats
	chatStats: {
		averageResponseTime: number
		averageCitationCount: number
		averageContextFiles: number
		totalMessages: number
	}

	editGuidanceStats: {
		averagePlanGenerationTime: number
		averageStepExecutionTime: number
		averageRelatedFiles: number
		totalPlans: number
		totalSteps: number
	}

	completionsStats: {
		averageGenerationTime: number
		averageConfidenceScore: number
		averageSemanticMatches: number
		totalCompletions: number
		acceptanceRate: number
	}

	slackStats: {
		averageShareTime: number
		totalShares: number
		successfulShares: number
		failedShares: number
	}

	// Performance issues
	slowOperations: AIMetrics[]
	highMemoryOperations: AIMetrics[]
	failedOperationsList: AIMetrics[]

	// Threshold violations
	thresholdViolations: {
		chatResponseTime: number
		editPlanTime: number
		completionTime: number
		slackShareTime: number
	}
}

/**
 * AI feature performance thresholds
 */
export interface AIPerformanceThresholds {
	chat: {
		maxResponseTime: number // ms
		maxCitationGenerationTime: number // ms
		maxContextSearchTime: number // ms
		warningResponseTime: number // ms
	}

	editGuidance: {
		maxPlanGenerationTime: number // ms
		maxStepExecutionTime: number // ms
		maxASTAnalysisTime: number // ms
		warningPlanTime: number // ms
	}

	completions: {
		maxGenerationTime: number // ms
		maxSemanticSearchTime: number // ms
		maxNLToCodeTime: number // ms
		warningGenerationTime: number // ms
		minConfidenceScore: number // 0-1
	}

	slack: {
		maxShareTime: number // ms
		maxOAuthTime: number // ms
		warningShareTime: number // ms
	}

	vector: {
		maxEmbeddingTime: number // ms
		maxSimilaritySearchTime: number // ms
	}
}

/**
 * AI Metrics Collector Service
 */
export class AIMetricsCollector {
	private static instance: AIMetricsCollector
	private metrics: AIMetrics[] = []
	private thresholds: AIPerformanceThresholds

	private constructor() {
		this.thresholds = this.getDefaultThresholds()
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(): AIMetricsCollector {
		if (!AIMetricsCollector.instance) {
			AIMetricsCollector.instance = new AIMetricsCollector()
		}
		return AIMetricsCollector.instance
	}

	/**
	 * Initialize AI metrics collector
	 */
	async initialize(): Promise<void> {
		try {
			Logger.info("AIMetricsCollector.initialize", "AI metrics collector initialized")
		} catch (error) {
			Logger.error("AIMetricsCollector.initialize", "Failed to initialize AI metrics collector", error)
		}
	}

	/**
	 * Record chat request metric
	 */
	recordChatRequest(
		operationId: string,
		messageLength: number,
		citationCount: number,
		contextFilesCount: number,
		responseLength: number,
		duration: number,
		success: boolean,
		error?: string,
	): void {
		const metric: AIMetrics = {
			operationId,
			operationType: "chat_request" as AIMetricType,
			aiFeature: "chat",
			aiMetricType: "chat_request" as AIMetricType,
			startTime: Date.now() - duration,
			endTime: Date.now(),
			duration,
			memoryUsageBefore: this.getCurrentMemoryUsage(),
			memoryUsageAfter: this.getCurrentMemoryUsage(),
			success,
			error,
			chatMetrics: {
				messageLength,
				citationCount,
				contextFilesCount,
				responseLength,
			},
		}

		this.addMetric(metric)
		this.checkChatThresholds(metric)
	}

	/**
	 * Record edit plan generation metric
	 */
	recordEditPlanGeneration(
		operationId: string,
		stepCount: number,
		relatedFilesCount: number,
		astNodesAnalyzed: number,
		dependenciesDetected: number,
		duration: number,
		success: boolean,
		error?: string,
	): void {
		const metric: AIMetrics = {
			operationId,
			operationType: "edit_plan_generation" as AIMetricType,
			aiFeature: "edit_guidance",
			aiMetricType: "edit_plan_generation" as AIMetricType,
			startTime: Date.now() - duration,
			endTime: Date.now(),
			duration,
			memoryUsageBefore: this.getCurrentMemoryUsage(),
			memoryUsageAfter: this.getCurrentMemoryUsage(),
			success,
			error,
			editMetrics: {
				planStepCount: stepCount,
				relatedFilesCount,
				astNodesAnalyzed,
				dependenciesDetected,
			},
		}

		this.addMetric(metric)
		this.checkEditGuidanceThresholds(metric)
	}

	/**
	 * Record completion generation metric
	 */
	recordCompletionGeneration(
		operationId: string,
		completionLength: number,
		confidenceScore: number,
		semanticMatches: number,
		contextFilesScanned: number,
		duration: number,
		success: boolean,
		error?: string,
	): void {
		const metric: AIMetrics = {
			operationId,
			operationType: "completion_generation" as AIMetricType,
			aiFeature: "completions",
			aiMetricType: "completion_generation" as AIMetricType,
			startTime: Date.now() - duration,
			endTime: Date.now(),
			duration,
			memoryUsageBefore: this.getCurrentMemoryUsage(),
			memoryUsageAfter: this.getCurrentMemoryUsage(),
			success,
			error,
			completionMetrics: {
				completionLength,
				confidenceScore,
				semanticMatches,
				contextFilesScanned,
			},
		}

		this.addMetric(metric)
		this.checkCompletionsThresholds(metric)
	}

	/**
	 * Record Slack share metric
	 */
	recordSlackShare(
		operationId: string,
		messageSize: number,
		channelCount: number,
		attachmentCount: number,
		duration: number,
		success: boolean,
		error?: string,
	): void {
		const metric: AIMetrics = {
			operationId,
			operationType: "slack_message_share" as AIMetricType,
			aiFeature: "slack_integration",
			aiMetricType: "slack_message_share" as AIMetricType,
			startTime: Date.now() - duration,
			endTime: Date.now(),
			duration,
			memoryUsageBefore: this.getCurrentMemoryUsage(),
			memoryUsageAfter: this.getCurrentMemoryUsage(),
			success,
			error,
			slackMetrics: {
				messageSize,
				channelCount,
				attachmentCount,
			},
		}

		this.addMetric(metric)
		this.checkSlackThresholds(metric)
	}

	/**
	 * Record semantic search metric
	 */
	recordSemanticSearch(
		operationId: string,
		embeddingDimension: number,
		similarityScore: number,
		indexSize: number,
		duration: number,
		success: boolean,
		error?: string,
	): void {
		const metric: AIMetrics = {
			operationId,
			operationType: "semantic_search" as AIMetricType,
			aiFeature: "completions",
			aiMetricType: "semantic_search" as AIMetricType,
			startTime: Date.now() - duration,
			endTime: Date.now(),
			duration,
			memoryUsageBefore: this.getCurrentMemoryUsage(),
			memoryUsageAfter: this.getCurrentMemoryUsage(),
			success,
			error,
			vectorMetrics: {
				embeddingDimension,
				similarityScore,
				indexSize,
			},
		}

		this.addMetric(metric)
	}

	/**
	 * Get AI performance report
	 */
	getAIReport(startTime: Date, endTime: Date): AIPerformanceReport {
		const filteredMetrics = this.metrics.filter(
			(m) => m.startTime >= startTime.getTime() && m.endTime && m.endTime <= endTime.getTime(),
		)

		const successfulOperations = filteredMetrics.filter((m) => m.success)
		const failedOperations = filteredMetrics.filter((m) => !m.success)
		const successRate =
			filteredMetrics.length > 0 ? (successfulOperations.length / filteredMetrics.length) * 100 : 0

		// Chat stats
		const chatMetrics = filteredMetrics.filter((m) => m.aiFeature === "chat" && m.chatMetrics)
		const chatStats = this.calculateChatStats(chatMetrics)

		// Edit guidance stats
		const editMetrics = filteredMetrics.filter((m) => m.aiFeature === "edit_guidance" && m.editMetrics)
		const editGuidanceStats = this.calculateEditGuidanceStats(editMetrics)

		// Completions stats
		const completionMetrics = filteredMetrics.filter((m) => m.aiFeature === "completions" && m.completionMetrics)
		const completionsStats = this.calculateCompletionsStats(completionMetrics)

		// Slack stats
		const slackMetrics = filteredMetrics.filter((m) => m.aiFeature === "slack_integration" && m.slackMetrics)
		const slackStats = this.calculateSlackStats(slackMetrics)

		// Performance issues
		const slowOperations = successfulOperations.sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 10)

		const highMemoryOperations = filteredMetrics
			.sort((a, b) => (b.memoryUsageAfter || 0) - (a.memoryUsageAfter || 0))
			.slice(0, 10)

		// Threshold violations
		const thresholdViolations = this.calculateThresholdViolations(filteredMetrics)

		return {
			timeRange: { start: startTime, end: endTime },
			totalOperations: filteredMetrics.length,
			successfulOperations: successfulOperations.length,
			failedOperationsCount: failedOperations.length,
			successRate,
			chatStats,
			editGuidanceStats,
			completionsStats,
			slackStats,
			slowOperations,
			highMemoryOperations,
			failedOperationsList: failedOperations.slice(0, 10),
			thresholdViolations,
		}
	}

	/**
	 * Get metrics by AI feature
	 */
	getMetricsByFeature(feature: AIMetrics["aiFeature"]): AIMetrics[] {
		return this.metrics.filter((m) => m.aiFeature === feature)
	}

	/**
	 * Get metrics by metric type
	 */
	getMetricsByType(metricType: AIMetricType): AIMetrics[] {
		return this.metrics.filter((m) => m.aiMetricType === metricType)
	}

	/**
	 * Clear old metrics
	 */
	clearMetrics(olderThan: number = 24 * 60 * 60 * 1000): number {
		const cutoffTime = Date.now() - olderThan
		const initialCount = this.metrics.length
		this.metrics = this.metrics.filter((m) => m.startTime > cutoffTime)
		return initialCount - this.metrics.length
	}

	/**
	 * Set AI performance thresholds
	 */
	setThresholds(thresholds: Partial<AIPerformanceThresholds>): void {
		this.thresholds = this.mergeThresholds(this.thresholds, thresholds)
		Logger.info("AIMetricsCollector.setThresholds", "Updated AI performance thresholds")
	}

	/**
	 * Get AI performance thresholds
	 */
	getThresholds(): AIPerformanceThresholds {
		return { ...this.thresholds }
	}

	/**
	 * Dispose AI metrics collector
	 */
	dispose(): void {
		this.metrics = []
		Logger.info("AIMetricsCollector.dispose", "AI metrics collector disposed")
	}

	/**
	 * Add metric to collection
	 */
	private addMetric(metric: AIMetrics): void {
		this.metrics.push(metric)
	}

	/**
	 * Check chat thresholds
	 */
	private checkChatThresholds(metric: AIMetrics): void {
		if (!metric.duration || !metric.success) return

		if (metric.duration > this.thresholds.chat.maxResponseTime) {
			Logger.warn(
				"AIMetricsCollector.checkChatThresholds",
				`Chat response time ${metric.duration}ms exceeds threshold of ${this.thresholds.chat.maxResponseTime}ms`,
			)
		} else if (metric.duration > this.thresholds.chat.warningResponseTime) {
			Logger.debug(
				"AIMetricsCollector.checkChatThresholds",
				`Chat response time ${metric.duration}ms approaching warning threshold`,
			)
		}
	}

	/**
	 * Check edit guidance thresholds
	 */
	private checkEditGuidanceThresholds(metric: AIMetrics): void {
		if (!metric.duration || !metric.success) return

		if (metric.duration > this.thresholds.editGuidance.maxPlanGenerationTime) {
			Logger.warn(
				"AIMetricsCollector.checkEditGuidanceThresholds",
				`Edit plan generation time ${metric.duration}ms exceeds threshold of ${this.thresholds.editGuidance.maxPlanGenerationTime}ms`,
			)
		} else if (metric.duration > this.thresholds.editGuidance.warningPlanTime) {
			Logger.debug(
				"AIMetricsCollector.checkEditGuidanceThresholds",
				`Edit plan generation time ${metric.duration}ms approaching warning threshold`,
			)
		}
	}

	/**
	 * Check completions thresholds
	 */
	private checkCompletionsThresholds(metric: AIMetrics): void {
		if (!metric.duration || !metric.success || !metric.completionMetrics) return

		if (metric.duration > this.thresholds.completions.maxGenerationTime) {
			Logger.warn(
				"AIMetricsCollector.checkCompletionsThresholds",
				`Completion generation time ${metric.duration}ms exceeds threshold of ${this.thresholds.completions.maxGenerationTime}ms`,
			)
		} else if (metric.duration > this.thresholds.completions.warningGenerationTime) {
			Logger.debug(
				"AIMetricsCollector.checkCompletionsThresholds",
				`Completion generation time ${metric.duration}ms approaching warning threshold`,
			)
		}

		if (metric.completionMetrics.confidenceScore < this.thresholds.completions.minConfidenceScore) {
			Logger.debug(
				"AIMetricsCollector.checkCompletionsThresholds",
				`Completion confidence score ${metric.completionMetrics.confidenceScore} below minimum threshold`,
			)
		}
	}

	/**
	 * Check Slack thresholds
	 */
	private checkSlackThresholds(metric: AIMetrics): void {
		if (!metric.duration || !metric.success) return

		if (metric.duration > this.thresholds.slack.maxShareTime) {
			Logger.warn(
				"AIMetricsCollector.checkSlackThresholds",
				`Slack share time ${metric.duration}ms exceeds threshold of ${this.thresholds.slack.maxShareTime}ms`,
			)
		} else if (metric.duration > this.thresholds.slack.warningShareTime) {
			Logger.debug(
				"AIMetricsCollector.checkSlackThresholds",
				`Slack share time ${metric.duration}ms approaching warning threshold`,
			)
		}
	}

	/**
	 * Calculate chat statistics
	 */
	private calculateChatStats(metrics: AIMetrics[]): AIPerformanceReport["chatStats"] {
		if (metrics.length === 0) {
			return {
				averageResponseTime: 0,
				averageCitationCount: 0,
				averageContextFiles: 0,
				totalMessages: 0,
			}
		}

		const successfulMetrics = metrics.filter((m) => m.success && m.chatMetrics)

		return {
			averageResponseTime:
				successfulMetrics.length > 0
					? successfulMetrics.reduce((sum, m) => sum + (m.duration || 0), 0) / successfulMetrics.length
					: 0,
			averageCitationCount:
				successfulMetrics.length > 0
					? successfulMetrics.reduce((sum, m) => sum + (m.chatMetrics?.citationCount || 0), 0) /
						successfulMetrics.length
					: 0,
			averageContextFiles:
				successfulMetrics.length > 0
					? successfulMetrics.reduce((sum, m) => sum + (m.chatMetrics?.contextFilesCount || 0), 0) /
						successfulMetrics.length
					: 0,
			totalMessages: metrics.length,
		}
	}

	/**
	 * Calculate edit guidance statistics
	 */
	private calculateEditGuidanceStats(metrics: AIMetrics[]): AIPerformanceReport["editGuidanceStats"] {
		if (metrics.length === 0) {
			return {
				averagePlanGenerationTime: 0,
				averageStepExecutionTime: 0,
				averageRelatedFiles: 0,
				totalPlans: 0,
				totalSteps: 0,
			}
		}

		const successfulMetrics = metrics.filter((m) => m.success && m.editMetrics)

		return {
			averagePlanGenerationTime:
				successfulMetrics.length > 0
					? successfulMetrics.reduce((sum, m) => sum + (m.duration || 0), 0) / successfulMetrics.length
					: 0,
			averageStepExecutionTime: 0, // Would need separate step execution metrics
			averageRelatedFiles:
				successfulMetrics.length > 0
					? successfulMetrics.reduce((sum, m) => sum + (m.editMetrics?.relatedFilesCount || 0), 0) /
						successfulMetrics.length
					: 0,
			totalPlans: metrics.length,
			totalSteps: successfulMetrics.reduce((sum, m) => sum + (m.editMetrics?.planStepCount || 0), 0),
		}
	}

	/**
	 * Calculate completions statistics
	 */
	private calculateCompletionsStats(metrics: AIMetrics[]): AIPerformanceReport["completionsStats"] {
		if (metrics.length === 0) {
			return {
				averageGenerationTime: 0,
				averageConfidenceScore: 0,
				averageSemanticMatches: 0,
				totalCompletions: 0,
				acceptanceRate: 0,
			}
		}

		const successfulMetrics = metrics.filter((m) => m.success && m.completionMetrics)

		return {
			averageGenerationTime:
				successfulMetrics.length > 0
					? successfulMetrics.reduce((sum, m) => sum + (m.duration || 0), 0) / successfulMetrics.length
					: 0,
			averageConfidenceScore:
				successfulMetrics.length > 0
					? successfulMetrics.reduce((sum, m) => sum + (m.completionMetrics?.confidenceScore || 0), 0) /
						successfulMetrics.length
					: 0,
			averageSemanticMatches:
				successfulMetrics.length > 0
					? successfulMetrics.reduce((sum, m) => sum + (m.completionMetrics?.semanticMatches || 0), 0) /
						successfulMetrics.length
					: 0,
			totalCompletions: metrics.length,
			acceptanceRate: 0, // Would need acceptance tracking
		}
	}

	/**
	 * Calculate Slack statistics
	 */
	private calculateSlackStats(metrics: AIMetrics[]): AIPerformanceReport["slackStats"] {
		if (metrics.length === 0) {
			return {
				averageShareTime: 0,
				totalShares: 0,
				successfulShares: 0,
				failedShares: 0,
			}
		}

		const successfulMetrics = metrics.filter((m) => m.success)
		const failedMetrics = metrics.filter((m) => !m.success)

		return {
			averageShareTime:
				successfulMetrics.length > 0
					? successfulMetrics.reduce((sum, m) => sum + (m.duration || 0), 0) / successfulMetrics.length
					: 0,
			totalShares: metrics.length,
			successfulShares: successfulMetrics.length,
			failedShares: failedMetrics.length,
		}
	}

	/**
	 * Calculate threshold violations
	 */
	private calculateThresholdViolations(metrics: AIMetrics[]): AIPerformanceReport["thresholdViolations"] {
		return {
			chatResponseTime: metrics.filter(
				(m) => m.aiFeature === "chat" && m.duration && m.duration > this.thresholds.chat.maxResponseTime,
			).length,
			editPlanTime: metrics.filter(
				(m) =>
					m.aiFeature === "edit_guidance" &&
					m.duration &&
					m.duration > this.thresholds.editGuidance.maxPlanGenerationTime,
			).length,
			completionTime: metrics.filter(
				(m) =>
					m.aiFeature === "completions" &&
					m.duration &&
					m.duration > this.thresholds.completions.maxGenerationTime,
			).length,
			slackShareTime: metrics.filter(
				(m) =>
					m.aiFeature === "slack_integration" &&
					m.duration &&
					m.duration > this.thresholds.slack.maxShareTime,
			).length,
		}
	}

	/**
	 * Get default thresholds
	 */
	private getDefaultThresholds(): AIPerformanceThresholds {
		return {
			chat: {
				maxResponseTime: 5000, // 5 seconds
				maxCitationGenerationTime: 2000, // 2 seconds
				maxContextSearchTime: 1000, // 1 second
				warningResponseTime: 3000, // 3 seconds
			},
			editGuidance: {
				maxPlanGenerationTime: 10000, // 10 seconds
				maxStepExecutionTime: 5000, // 5 seconds
				maxASTAnalysisTime: 3000, // 3 seconds
				warningPlanTime: 7000, // 7 seconds
			},
			completions: {
				maxGenerationTime: 500, // 500ms
				maxSemanticSearchTime: 200, // 200ms
				maxNLToCodeTime: 1000, // 1 second
				warningGenerationTime: 300, // 300ms
				minConfidenceScore: 0.7, // 70%
			},
			slack: {
				maxShareTime: 5000, // 5 seconds
				maxOAuthTime: 10000, // 10 seconds
				warningShareTime: 3000, // 3 seconds
			},
			vector: {
				maxEmbeddingTime: 1000, // 1 second
				maxSimilaritySearchTime: 200, // 200ms
			},
		}
	}

	/**
	 * Merge thresholds
	 */
	private mergeThresholds(
		base: AIPerformanceThresholds,
		partial: Partial<AIPerformanceThresholds>,
	): AIPerformanceThresholds {
		return {
			chat: { ...base.chat, ...partial.chat },
			editGuidance: { ...base.editGuidance, ...partial.editGuidance },
			completions: { ...base.completions, ...partial.completions },
			slack: { ...base.slack, ...partial.slack },
			vector: { ...base.vector, ...partial.vector },
		}
	}

	/**
	 * Get current memory usage
	 */
	private getCurrentMemoryUsage(): number {
		try {
			const usage = process.memoryUsage()
			return usage.heapUsed
		} catch (error) {
			Logger.error("AIMetricsCollector.getCurrentMemoryUsage", "Failed to get memory usage", error)
			return 0
		}
	}
}
