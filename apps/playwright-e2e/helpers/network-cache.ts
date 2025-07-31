// kilocode_change - new file
import { type Page, type BrowserContext } from "@playwright/test"
import * as path from "path"
import * as fs from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface NetworkCacheOptions {
	cacheDir?: string
	updateMode?: "full" | "minimal" | "none"
	urlPattern?: string | RegExp
}

export class NetworkCache {
	private cacheDir: string
	private updateMode: "full" | "minimal" | "none"
	private urlPattern: string | RegExp

	constructor(options: NetworkCacheOptions = {}) {
		this.cacheDir = options.cacheDir || path.join(__dirname, "..", "network-cache")
		this.updateMode = options.updateMode || "minimal"
		this.urlPattern = options.urlPattern || "**/api/**"
	}

	async ensureCacheDir(): Promise<void> {
		await fs.promises.mkdir(this.cacheDir, { recursive: true })
	}

	getHarPath(testName: string): string {
		const sanitized = testName.replace(/[^a-zA-Z0-9-_]/g, "_")
		return path.join(this.cacheDir, `${sanitized}.har`)
	}

	async sanitizeHarFile(harPath: string): Promise<void> {
		try {
			const harContent = await fs.promises.readFile(harPath, "utf-8")
			const harData = JSON.parse(harContent)

			// Sanitize all entries
			if (harData.log && harData.log.entries) {
				for (const entry of harData.log.entries) {
					if (entry.request?.headers) {
						entry.request.headers = this.sanitizeHeaders(entry.request.headers)
					}
					if (entry.response?.headers) {
						entry.response.headers = this.sanitizeHeaders(entry.response.headers)
					}
				}
			}

			// Write back the sanitized HAR file
			await fs.promises.writeFile(harPath, JSON.stringify(harData, null, 2))
			console.log(`🔒 Sanitized API keys from HAR file: ${path.basename(harPath)}`)
		} catch (error) {
			console.warn(`⚠️ Failed to sanitize HAR file ${harPath}: ${error.message}`)
		}
	}

	private sanitizeHeaders(headers: Record<string, string>[]): Record<string, string>[] {
		const sensitiveHeaders = ["authorization", "x-api-key", "api-key", "bearer"]

		return headers.map((header) => {
			const headerName = header.name.toLowerCase()
			if (sensitiveHeaders.some((sensitive) => headerName.includes(sensitive))) {
				return {
					...header,
					value: this.redactApiKey(header.value),
				}
			}
			return header
		})
	}
	private redactApiKey(value: string): string {
		// Redact API keys with standardized format
		if (value.startsWith("Bearer ")) {
			const token = value.substring(7)
			if (token.startsWith("sk-")) {
				return `Bearer sk-[REDACTED]`
			}
			return `Bearer [REDACTED]`
		}

		// For direct API key formats
		if (value.startsWith("sk-")) {
			return `sk-[REDACTED]`
		}

		return "[REDACTED]"
	}
	async setupHarRecording(context: BrowserContext, testName: string): Promise<void> {
		await this.ensureCacheDir()
		const harPath = this.getHarPath(testName)

		console.log(`🎬 Setting up HAR recording for test: ${testName}`)
		console.log(`📁 HAR file path: ${harPath}`)

		const harExists = fs.existsSync(harPath)
		if (harExists && this.updateMode === "none") {
			console.log(`📼 Using existing HAR file (no update mode)`)
			await context.routeFromHAR(harPath, {
				url: this.urlPattern,
				update: false,
			})
		} else if (harExists && this.updateMode === "minimal") {
			console.log(`📼 Using existing HAR file with minimal updates`)
			await context.routeFromHAR(harPath, {
				url: this.urlPattern,
				update: false,
				updateMode: "minimal",
			})
		} else {
			console.log(`🔴 Recording new HAR file (${harExists ? "full update" : "new file"})`)
			const updateMode = this.updateMode === "none" ? "minimal" : this.updateMode
			await context.routeFromHAR(harPath, {
				url: this.urlPattern,
				update: true,
				updateMode: updateMode,
			})
		}
	}

	async setupPageRecording(page: Page, testName: string): Promise<void> {
		await this.ensureCacheDir()
		const harPath = this.getHarPath(testName)

		console.log(`🎬 Setting up page HAR recording for test: ${testName}`)
		console.log(`📁 HAR file path: ${harPath}`)

		// Check if HAR file exists
		const harExists = fs.existsSync(harPath)

		if (harExists && this.updateMode === "none") {
			console.log(`📼 Using existing HAR file (no update mode)`)
			await page.routeFromHAR(harPath, {
				url: this.urlPattern,
				update: false,
			})
		} else if (harExists && this.updateMode === "minimal") {
			console.log(`📼 Using existing HAR file with minimal updates`)
			await page.routeFromHAR(harPath, {
				url: this.urlPattern,
				update: false,
				updateMode: "minimal",
			})
		} else {
			console.log(`🔴 Recording new HAR file (${harExists ? "full update" : "new file"})`)
			const updateMode = this.updateMode === "none" ? "minimal" : this.updateMode
			await page.routeFromHAR(harPath, {
				url: this.urlPattern,
				update: true,
				updateMode: updateMode,
			})
		}
	}

	async clearCache(): Promise<void> {
		try {
			await fs.promises.rm(this.cacheDir, { recursive: true })
			console.log(`🗑️ Cleared network cache directory: ${this.cacheDir}`)
		} catch (error) {
			console.warn(`⚠️ Failed to clear cache directory: ${error.message}`)
		}
	}

	async listCachedTests(): Promise<string[]> {
		try {
			await this.ensureCacheDir()
			const files = await fs.promises.readdir(this.cacheDir)
			return files.filter((f) => f.endsWith(".har")).map((f) => f.replace(".har", ""))
		} catch (error) {
			console.warn(`⚠️ Failed to list cached tests: ${error.message}`)
			return []
		}
	}

	async sanitizeAllHarFiles(): Promise<void> {
		try {
			await this.ensureCacheDir()
			const files = await fs.promises.readdir(this.cacheDir)
			const harFiles = files.filter((f) => f.endsWith(".har"))

			console.log(`🔒 Sanitizing ${harFiles.length} HAR files...`)

			for (const harFile of harFiles) {
				const harPath = path.join(this.cacheDir, harFile)
				await this.sanitizeHarFile(harPath)
			}

			console.log(`✅ Sanitized all HAR files`)
		} catch (error) {
			console.warn(`⚠️ Failed to sanitize HAR files: ${error.message}`)
		}
	}

	async verifyHarSanitization(harPath: string): Promise<{ sanitized: number; violations: number }> {
		try {
			const content = await fs.promises.readFile(harPath, "utf-8")

			const sensitivePatterns = [
				/sk-[a-zA-Z0-9]{48,}/g, // OpenRouter/OpenAI API keys
				/Bearer\s+sk-[a-zA-Z0-9]{48,}/g, // Bearer tokens with full keys
				/x-api-key:\s*[a-zA-Z0-9]{20,}/g, // Generic API keys
				/authorization:\s*[a-zA-Z0-9]{20,}/g, // Authorization headers with full keys
			]

			const expectedSanitizedPatterns = [
				/Bearer sk-\[REDACTED\]/g, // Expected sanitized format
				/sk-\[REDACTED\]/g, // Expected sanitized format without Bearer
				/"authorization"[^}]*"Bearer sk-\[REDACTED\]"/g, // In JSON context
				/"Authorization"[^}]*"Bearer sk-\[REDACTED\]"/g, // In JSON context
			]

			// Check for unsanitized sensitive data
			let violations = 0
			for (const pattern of sensitivePatterns) {
				const matches = content.match(pattern)
				if (matches) {
					violations += matches.length
					console.error(`❌ Found ${matches.length} unsanitized API key(s) in ${path.basename(harPath)}`)
					matches.forEach((match) => {
						console.error(`   "${match.substring(0, 20)}..."`)
					})
				}
			}

			// Check for properly sanitized data
			let sanitized = 0
			for (const pattern of expectedSanitizedPatterns) {
				const matches = content.match(pattern)
				if (matches) {
					sanitized += matches.length
				}
			}

			return { sanitized, violations }
		} catch (error) {
			console.warn(`⚠️ Failed to verify HAR file ${harPath}: ${error.message}`)
			return { sanitized: 0, violations: 0 }
		}
	}
}

// Default instance
export const networkCache = new NetworkCache()
