// kilocode_change - new file

import type { ObservationStep } from "./types"

export interface ErrorPattern {
	pattern: RegExp
	recoveryAction: string
	searchQuery?: string
	maxRetries?: number
}

export interface SelfHealingConfig {
	defaultMaxRetries: number
	enableAutoRecovery: boolean
	errorPatterns: ErrorPattern[]
}

export interface HealingResult {
	success: boolean
	action: string
	error: string | null
	retryCount: number
	willRetry: boolean
}

export interface ErrorContext {
	toolName: string
	errorMessage: string
	stackTrace?: string
	filePath?: string
	lineNumber?: number
	previousAttempts: number
}

const DEFAULT_ERROR_PATTERNS: ErrorPattern[] = [
	{
		pattern: /SyntaxError|syntax error/i,
		recoveryAction: "search_codebase",
		searchQuery: "syntax error source code",
		maxRetries: 2,
	},
	{
		pattern: /ReferenceError|name '.*' is not defined/i,
		recoveryAction: "search_codebase",
		searchQuery: "undefined variable import",
		maxRetries: 2,
	},
	{
		pattern: /TypeError|cannot read property/i,
		recoveryAction: "search_codebase",
		searchQuery: "type error undefined",
		maxRetries: 2,
	},
	{
		pattern: /ImportError|ModuleNotFoundError|no module named/i,
		recoveryAction: "check_dependencies",
		searchQuery: "missing dependency",
		maxRetries: 3,
	},
	{
		pattern: /JSONDecodeError|JSON parse error/i,
		recoveryAction: "validate_json",
		searchQuery: "json validation",
		maxRetries: 2,
	},
	{
		pattern: /PermissionError|EACCES|EPERM/i,
		recoveryAction: "check_permissions",
		searchQuery: "file permissions",
		maxRetries: 1,
	},
	{
		pattern: /FileNotFoundError|ENOENT|no such file/i,
		recoveryAction: "verify_file_exists",
		searchQuery: "file path",
		maxRetries: 2,
	},
	{
		pattern: /ConnectionError|ECONNREFUSED/i,
		recoveryAction: "check_connection",
		searchQuery: "network connection",
		maxRetries: 3,
	},
	{
		pattern: /TimeoutError|Timed out/i,
		recoveryAction: "increase_timeout",
		searchQuery: "timeout configuration",
		maxRetries: 2,
	},
	{
		pattern: /MemoryError|Out of memory/i,
		recoveryAction: "optimize_memory",
		searchQuery: "memory usage",
		maxRetries: 1,
	},
	// Odoo-specific patterns
	{
		pattern: /IntegrityError|violates foreign key/i,
		recoveryAction: "check_odoo_access",
		searchQuery: "ir.model.access.csv",
		maxRetries: 2,
	},
	{
		pattern: /AccessError|AccessDenied|permission denied/i,
		recoveryAction: "check_odoo_access",
		searchQuery: "access rights",
		maxRetries: 2,
	},
	{
		pattern: /ValidationError|Field .* not found/i,
		recoveryAction: "check_odoo_model",
		searchQuery: "odoo model inheritance",
		maxRetries: 2,
	},
	{
		pattern: /RPCError|odoo\.exceptions/i,
		recoveryAction: "check_odoo_rpc",
		searchQuery: "odoo rpc call",
		maxRetries: 3,
	},
	{
		pattern: /DatabaseError|psycopg2/i,
		recoveryAction: "check_odoo_db",
		searchQuery: "postgresql database",
		maxRetries: 2,
	},
]

export class SelfHealingStrategy {
	private config: SelfHealingConfig
	private errorHistory: Map<string, number> = new Map()

	constructor(partialConfig?: Partial<SelfHealingConfig>) {
		this.config = {
			defaultMaxRetries: partialConfig?.defaultMaxRetries ?? 3,
			enableAutoRecovery: partialConfig?.enableAutoRecovery ?? true,
			errorPatterns: partialConfig?.errorPatterns ?? DEFAULT_ERROR_PATTERNS,
		}
	}

	async analyzeAndHeal(context: ErrorContext): Promise<HealingResult> {
		const errorKey = `${context.toolName}:${this.hashError(context.errorMessage)}`
		const previousCount = this.errorHistory.get(errorKey) ?? 0

		const matchedPattern = this.findMatchingPattern(context.errorMessage)

		if (!matchedPattern) {
			return {
				success: false,
				action: "no_recovery",
				error: null,
				retryCount: previousCount,
				willRetry: false,
			}
		}

		const maxRetries = matchedPattern.maxRetries ?? this.config.defaultMaxRetries

		if (previousCount >= maxRetries) {
			return {
				success: false,
				action: "escalate",
				error: `Max retries (${maxRetries}) exceeded for: ${matchedPattern.recoveryAction}`,
				retryCount: previousCount,
				willRetry: false,
			}
		}

		// Increment error count
		this.errorHistory.set(errorKey, previousCount + 1)

		return {
			success: this.config.enableAutoRecovery,
			action: matchedPattern.recoveryAction,
			error: null,
			retryCount: previousCount + 1,
			willRetry: true,
		}
	}

	private findMatchingPattern(errorMessage: string): ErrorPattern | null {
		for (const pattern of this.config.errorPatterns) {
			if (pattern.pattern.test(errorMessage)) {
				return pattern
			}
		}
		return null
	}

	private hashError(error: string): string {
		// Simple hash for error grouping
		let hash = 0
		for (let i = 0; i < Math.min(error.length, 100); i++) {
			const char = error.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash
		}
		return Math.abs(hash).toString(36)
	}

	getRecoveryAction(context: ErrorContext): string | null {
		const matchedPattern = this.findMatchingPattern(context.errorMessage)
		return matchedPattern?.recoveryAction ?? null
	}

	getSearchQuery(context: ErrorContext): string | null {
		const matchedPattern = this.findMatchingPattern(context.errorMessage)
		return matchedPattern?.searchQuery ?? null
	}

	shouldRetry(context: ErrorContext): boolean {
		const matchedPattern = this.findMatchingPattern(context.errorMessage)
		if (!matchedPattern) return false

		const errorKey = `${context.toolName}:${this.hashError(context.errorMessage)}`
		const previousCount = this.errorHistory.get(errorKey) ?? 0
		const maxRetries = matchedPattern.maxRetries ?? this.config.defaultMaxRetries

		return previousCount < maxRetries
	}

	clearErrorHistory(): void {
		this.errorHistory.clear()
	}

	getErrorStats(): { totalErrors: number; uniqueErrors: number } {
		return {
			totalErrors: Array.from(this.errorHistory.values()).reduce((a, b) => a + b, 0),
			uniqueErrors: this.errorHistory.size,
		}
	}

	// Analyze observation step result for errors
	analyzeObservationStep(step: ObservationStep): ErrorContext | null {
		if (step.status !== "failed" || !step.error) {
			return null
		}

		return {
			toolName: step.id,
			errorMessage: step.error,
			previousAttempts: 0,
		}
	}

	// Create a recovery plan based on error analysis
	async createRecoveryPlan(errorContext: ErrorContext): Promise<RecoveryPlan> {
		const healingResult = await this.analyzeAndHeal(errorContext)

		return {
			steps: healingResult.willRetry
				? [
						{
							action: healingResult.action,
							description: `Attempt ${healingResult.retryCount + 1}: ${healingResult.action}`,
							searchQuery: this.getSearchQuery(errorContext) ?? undefined,
						},
					]
				: [],
			escalate: !healingResult.willRetry,
			escalationReason: healingResult.error ?? "Unknown error pattern",
		}
	}
}

export interface RecoveryPlanStep {
	action: string
	description: string
	searchQuery?: string
}

export interface RecoveryPlan {
	steps: RecoveryPlanStep[]
	escalate: boolean
	escalationReason: string
}
