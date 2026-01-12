/**
 * AI Features Security Validation and Input Sanitization
 *
 * Security utilities for AI features:
 * - Input validation and sanitization
 * - Output sanitization
 * - Rate limiting
 * - Content filtering
 *
 * kilocode_change - new file
 */

/**
 * Security validation result
 */
export interface ValidationResult {
	valid: boolean
	errors: string[]
	warnings: string[]
	sanitized?: any
}

/**
 * Input validation rules
 */
export interface ValidationRule {
	name: string
	validate: (value: any) => boolean
	errorMessage: string
}

/**
 * Security configuration
 */
export interface SecurityConfig {
	maxMessageLength: number
	maxFilePathLength: number
	maxCitationCount: number
	allowedFileExtensions: string[]
	bannedPatterns: RegExp[]
	enableContentFiltering: boolean
	enableRateLimiting: boolean
	maxRequestsPerMinute: number
}

/**
 * Default security configuration
 */
const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
	maxMessageLength: 100000,
	maxFilePathLength: 1000,
	maxCitationCount: 50,
	allowedFileExtensions: [
		".ts",
		".tsx",
		".js",
		".jsx",
		".py",
		".java",
		".go",
		".rs",
		".c",
		".cpp",
		".h",
		".hpp",
		".md",
		".json",
		".yaml",
		".yml",
	],
	bannedPatterns: [
		/eval\s*\(/i,
		/exec\s*\(/i,
		/Function\s*\(/i,
		/document\.cookie/i,
		/innerHTML\s*=/i,
		/outerHTML\s*=/i,
	],
	enableContentFiltering: true,
	enableRateLimiting: true,
	maxRequestsPerMinute: 60,
}

/**
 * Security Validator
 */
export class AISecurityValidator {
	private config: SecurityConfig
	private requestTimestamps: number[] = []

	constructor(config?: Partial<SecurityConfig>) {
		this.config = { ...DEFAULT_SECURITY_CONFIG, ...config }
	}

	/**
	 * Validate chat message input
	 */
	validateChatMessage(message: string): ValidationResult {
		const errors: string[] = []
		const warnings: string[] = []

		// Check message length
		if (message.length > this.config.maxMessageLength) {
			errors.push(`Message length ${message.length} exceeds maximum ${this.config.maxMessageLength}`)
		}

		// Check for banned patterns
		for (const pattern of this.config.bannedPatterns) {
			if (pattern.test(message)) {
				errors.push(`Message contains potentially harmful pattern: ${pattern.source}`)
			}
		}

		// Check for suspicious content
		if (this.config.enableContentFiltering) {
			const suspiciousContent = this.detectSuspiciousContent(message)
			if (suspiciousContent.length > 0) {
				warnings.push(...suspiciousContent)
			}
		}

		// Sanitize message
		const sanitized = this.sanitizeString(message)

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			sanitized,
		}
	}

	/**
	 * Validate file path
	 */
	validateFilePath(filePath: string): ValidationResult {
		const errors: string[] = []
		const warnings: string[] = []

		// Check path length
		if (filePath.length > this.config.maxFilePathLength) {
			errors.push(`File path length ${filePath.length} exceeds maximum ${this.config.maxFilePathLength}`)
		}

		// Check for path traversal
		if (filePath.includes("..") || filePath.includes("~")) {
			errors.push("File path contains potentially dangerous path traversal")
		}

		// Check file extension
		const extension = this.getFileExtension(filePath)
		if (extension && !this.config.allowedFileExtensions.includes(extension)) {
			warnings.push(`File extension ${extension} may not be supported`)
		}

		// Check for absolute paths (may be sensitive)
		if (filePath.startsWith("/") || filePath.match(/^[A-Za-z]:\\/)) {
			warnings.push("Absolute file path detected")
		}

		// Sanitize path
		const sanitized = this.sanitizePath(filePath)

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			sanitized,
		}
	}

	/**
	 * Validate citation
	 */
	validateCitation(citation: any): ValidationResult {
		const errors: string[] = []
		const warnings: string[] = []

		// Check required fields
		if (!citation.sourcePath) {
			errors.push("Citation missing sourcePath")
		}

		if (!citation.snippet || citation.snippet.length === 0) {
			errors.push("Citation missing snippet")
		}

		// Validate confidence score
		if (citation.confidence !== undefined) {
			if (typeof citation.confidence !== "number" || citation.confidence < 0 || citation.confidence > 1) {
				errors.push("Citation confidence must be between 0 and 1")
			}
		}

		// Validate line numbers
		if (citation.startLine !== undefined && citation.startLine < 0) {
			errors.push("Citation startLine must be non-negative")
		}

		if (citation.endLine !== undefined && citation.endLine < 0) {
			errors.push("Citation endLine must be non-negative")
		}

		if (
			citation.startLine !== undefined &&
			citation.endLine !== undefined &&
			citation.startLine > citation.endLine
		) {
			errors.push("Citation startLine must be less than or equal to endLine")
		}

		// Validate source path
		const pathValidation = this.validateFilePath(citation.sourcePath)
		if (!pathValidation.valid) {
			errors.push(...pathValidation.errors)
		}

		// Sanitize snippet
		const sanitized = {
			...citation,
			snippet: citation.snippet ? this.sanitizeString(citation.snippet) : "",
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			sanitized,
		}
	}

	/**
	 * Validate edit plan
	 */
	validateEditPlan(plan: any): ValidationResult {
		const errors: string[] = []
		const warnings: string[] = []

		// Check required fields
		if (!plan.title || plan.title.length === 0) {
			errors.push("Edit plan missing title")
		}

		if (!plan.steps || !Array.isArray(plan.steps)) {
			errors.push("Edit plan missing steps array")
		}

		// Validate steps
		if (plan.steps) {
			if (plan.steps.length > 100) {
				warnings.push(`Edit plan has ${plan.steps.length} steps, which may be excessive`)
			}

			for (let i = 0; i < plan.steps.length; i++) {
				const step = plan.steps[i]
				if (!step.title) {
					errors.push(`Step ${i} missing title`)
				}

				if (step.files && Array.isArray(step.files)) {
					for (const file of step.files) {
						if (file.filePath) {
							const fileValidation = this.validateFilePath(file.filePath)
							if (!fileValidation.valid) {
								errors.push(...fileValidation.errors.map((e) => `Step ${i}: ${e}`))
							}
						}
					}
				}
			}
		}

		// Sanitize plan
		const sanitized = {
			...plan,
			title: plan.title ? this.sanitizeString(plan.title) : "",
			description: plan.description ? this.sanitizeString(plan.description) : "",
			steps: plan.steps
				? plan.steps.map((step: any) => ({
						...step,
						title: step.title ? this.sanitizeString(step.title) : "",
						description: step.description ? this.sanitizeString(step.description) : "",
					}))
				: [],
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			sanitized,
		}
	}

	/**
	 * Validate completion
	 */
	validateCompletion(completion: any): ValidationResult {
		const errors: string[] = []
		const warnings: string[] = []

		// Check required fields
		if (!completion.text || completion.text.length === 0) {
			errors.push("Completion missing text")
		}

		// Validate confidence score
		if (completion.confidence !== undefined) {
			if (typeof completion.confidence !== "number" || completion.confidence < 0 || completion.confidence > 1) {
				errors.push("Completion confidence must be between 0 and 1")
			}
		}

		// Check for banned patterns in completion text
		for (const pattern of this.config.bannedPatterns) {
			if (pattern.test(completion.text)) {
				errors.push(`Completion contains potentially harmful pattern: ${pattern.source}`)
			}
		}

		// Sanitize completion text
		const sanitized = {
			...completion,
			text: this.sanitizeString(completion.text),
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			sanitized,
		}
	}

	/**
	 * Validate Slack message
	 */
	validateSlackMessage(message: string): ValidationResult {
		const errors: string[] = []
		const warnings: string[] = []

		// Check message length (Slack has a 4000 character limit)
		if (message.length > 4000) {
			errors.push("Slack message exceeds 4000 character limit")
		}

		// Check for banned patterns
		for (const pattern of this.config.bannedPatterns) {
			if (pattern.test(message)) {
				errors.push(`Message contains potentially harmful pattern: ${pattern.source}`)
			}
		}

		// Sanitize message
		const sanitized = this.sanitizeString(message)

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			sanitized,
		}
	}

	/**
	 * Check rate limit
	 */
	checkRateLimit(): { allowed: boolean; remaining: number; resetTime: number } {
		if (!this.config.enableRateLimiting) {
			return { allowed: true, remaining: Infinity, resetTime: Date.now() + 60000 }
		}

		const now = Date.now()
		const oneMinuteAgo = now - 60000

		// Remove timestamps older than one minute
		this.requestTimestamps = this.requestTimestamps.filter((t) => t > oneMinuteAgo)

		const remaining = this.config.maxRequestsPerMinute - this.requestTimestamps.length
		const allowed = remaining > 0

		if (allowed) {
			this.requestTimestamps.push(now)
		}

		return {
			allowed,
			remaining: Math.max(0, remaining),
			resetTime: now + 60000,
		}
	}

	/**
	 * Sanitize string input
	 */
	private sanitizeString(input: string): string {
		// Remove null bytes
		let sanitized = input.replace(/\0/g, "")

		// Normalize line endings
		sanitized = sanitized.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

		// Trim whitespace
		sanitized = sanitized.trim()

		return sanitized
	}

	/**
	 * Sanitize file path
	 */
	private sanitizePath(path: string): string {
		// Remove null bytes
		let sanitized = path.replace(/\0/g, "")

		// Normalize path separators
		sanitized = sanitized.replace(/\\/g, "/")

		// Remove redundant separators
		sanitized = sanitized.replace(/\/+/g, "/")

		// Remove leading/trailing separators
		sanitized = sanitized.replace(/^\/+|\/+$/g, "")

		return sanitized
	}

	/**
	 * Detect suspicious content
	 */
	private detectSuspiciousContent(content: string): string[] {
		const suspicious: string[] = []

		// Check for potential SQL injection
		if (content.match(/('|(\\)|;|--|\/\*|\*\/)/i)) {
			suspicious.push("Content contains potential SQL injection patterns")
		}

		// Check for potential XSS
		if (content.match(/<script|javascript:|onerror|onload/i)) {
			suspicious.push("Content contains potential XSS patterns")
		}

		// Check for potential command injection
		if (content.match(/[;&|`$()]/)) {
			suspicious.push("Content contains potential command injection patterns")
		}

		return suspicious
	}

	/**
	 * Get file extension
	 */
	private getFileExtension(filePath: string): string | null {
		const match = filePath.match(/\.([^.]+)$/)
		return match ? "." + match[1] : null
	}

	/**
	 * Update security configuration
	 */
	updateConfig(config: Partial<SecurityConfig>): void {
		this.config = { ...this.config, ...config }
	}

	/**
	 * Get current security configuration
	 */
	getConfig(): SecurityConfig {
		return { ...this.config }
	}
}

/**
 * Create security validator instance
 */
export function createSecurityValidator(config?: Partial<SecurityConfig>): AISecurityValidator {
	return new AISecurityValidator(config)
}

/**
 * Validate and sanitize input
 */
export function validateAndSanitize(
	type: "chat" | "file" | "citation" | "plan" | "completion" | "slack",
	input: any,
): ValidationResult {
	const validator = new AISecurityValidator()

	switch (type) {
		case "chat":
			return validator.validateChatMessage(input)
		case "file":
			return validator.validateFilePath(input)
		case "citation":
			return validator.validateCitation(input)
		case "plan":
			return validator.validateEditPlan(input)
		case "completion":
			return validator.validateCompletion(input)
		case "slack":
			return validator.validateSlackMessage(input)
		default:
			return {
				valid: false,
				errors: ["Unknown validation type"],
				warnings: [],
			}
	}
}
