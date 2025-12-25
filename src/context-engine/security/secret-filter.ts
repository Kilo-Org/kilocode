/**
 * Security utilities for filtering secrets and PII from code before embedding
 */

export interface SecretPattern {
	name: string
	pattern: RegExp
	replacement: string
}

export class SecretFilter {
	private patterns: SecretPattern[]
	private enabled: boolean

	constructor(enabled: boolean = true) {
		this.enabled = enabled
		this.patterns = this.getDefaultPatterns()
	}

	/**
	 * Filter secrets and PII from text
	 */
	filter(text: string): string {
		if (!this.enabled) {
			return text
		}

		let filtered = text

		for (const pattern of this.patterns) {
			filtered = filtered.replace(pattern.pattern, pattern.replacement)
		}

		return filtered
	}

	/**
	 * Detect if text contains secrets
	 */
	hasSecrets(text: string): boolean {
		if (!this.enabled) {
			return false
		}

		for (const pattern of this.patterns) {
			if (pattern.pattern.test(text)) {
				return true
			}
		}

		return false
	}

	/**
	 * Get list of detected secret types in text
	 */
	detectSecretTypes(text: string): string[] {
		if (!this.enabled) {
			return []
		}

		const detected: string[] = []

		for (const pattern of this.patterns) {
			if (pattern.pattern.test(text)) {
				detected.push(pattern.name)
			}
		}

		return detected
	}

	/**
	 * Add custom secret pattern
	 */
	addPattern(pattern: SecretPattern): void {
		this.patterns.push(pattern)
	}

	/**
	 * Get default secret patterns
	 */
	private getDefaultPatterns(): SecretPattern[] {
		return [
			// API Keys (generic long alphanumeric strings)
			{
				name: "Generic API Key",
				pattern: /[A-Za-z0-9_-]{32,}/g,
				replacement: "[REDACTED_API_KEY]",
			},

			// AWS Access Keys
			{
				name: "AWS Access Key",
				pattern: /AKIA[0-9A-Z]{16}/g,
				replacement: "[REDACTED_AWS_KEY]",
			},

			// Password assignments
			{
				name: "Password Assignment",
				pattern: /password\s*[=:]\s*["'][^"']{3,}["']/gi,
				replacement: 'password = "[REDACTED_PASSWORD]"',
			},

			// API Key assignments
			{
				name: "API Key Assignment",
				pattern: /api[-_]?key\s*[=:]\s*["'][^"']+["']/gi,
				replacement: 'api_key = "[REDACTED_API_KEY]"',
			},

			// Bearer tokens
			{
				name: "Bearer Token",
				pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/gi,
				replacement: "Bearer [REDACTED_TOKEN]",
			},

			// JWT tokens
			{
				name: "JWT Token",
				pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
				replacement: "[REDACTED_JWT]",
			},

			// Email addresses
			{
				name: "Email Address",
				pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
				replacement: "[REDACTED_EMAIL]",
			},

			// IP Addresses
			{
				name: "IP Address",
				pattern: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
				replacement: "[REDACTED_IP]",
			},

			// Phone numbers (US format)
			{
				name: "Phone Number",
				pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
				replacement: "[REDACTED_PHONE]",
			},

			// Credit card numbers
			{
				name: "Credit Card",
				pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
				replacement: "[REDACTED_CC]",
			},

			// Social Security Numbers
			{
				name: "SSN",
				pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
				replacement: "[REDACTED_SSN]",
			},

			// Private keys (PEM format)
			{
				name: "Private Key",
				pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
				replacement: "[REDACTED_PRIVATE_KEY]",
			},

			// GitHub Personal Access Tokens
			{
				name: "GitHub Token",
				pattern: /ghp_[A-Za-z0-9_]{36}/g,
				replacement: "[REDACTED_GITHUB_TOKEN]",
			},

			// Slack tokens
			{
				name: "Slack Token",
				pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
				replacement: "[REDACTED_SLACK_TOKEN]",
			},

			// OpenAI API Keys
			{
				name: "OpenAI API Key",
				pattern: /sk-[A-Za-z0-9]{48}/g,
				replacement: "[REDACTED_OPENAI_KEY]",
			},

			// Anthropic API Keys
			{
				name: "Anthropic API Key",
				pattern: /sk-ant-[A-Za-z0-9-]{95}/g,
				replacement: "[REDACTED_ANTHROPIC_KEY]",
			},

			// Database connection strings
			{
				name: "Database Connection",
				pattern: /(?:mongodb|mysql|postgresql|postgres):\/\/[^\s]+/gi,
				replacement: "[REDACTED_DB_CONNECTION]",
			},

			// Generic secret environment variables
			{
				name: "Secret Environment Variable",
				pattern: /(?:SECRET|TOKEN|KEY|PASSWORD)=["']?[^"'\s]{8,}["']?/gi,
				replacement: "SECRET=[REDACTED]",
			},
		]
	}

	/**
	 * Check if file should be excluded from indexing
	 */
	shouldExcludeFile(filePath: string): boolean {
		const sensitiveFiles = [
			".env",
			".env.local",
			".env.development",
			".env.production",
			".env.test",
			".pem",
			".key",
			".p12",
			".pfx",
			"secrets.json",
			"credentials.json",
			"service-account.json",
		]

		const fileName = filePath.toLowerCase()
		return sensitiveFiles.some((ext) => fileName.endsWith(ext))
	}

	/**
	 * Check if directory should be excluded from indexing
	 */
	shouldExcludeDirectory(dirPath: string): boolean {
		const sensitiveDirectories = ["secrets", "credentials", "private", ".ssh", ".gnupg", "certificates"]

		const dirName = dirPath.toLowerCase()
		return sensitiveDirectories.some((dir) => dirName.includes(dir))
	}

	/**
	 * Parse .kiloignore file and return patterns
	 */
	parseKiloignore(content: string): string[] {
		return content
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#"))
	}

	/**
	 * Enable or disable filtering
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled
	}
}
