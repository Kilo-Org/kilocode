// kilocode_change - new file

export interface LocalAIConfig {
	provider: "ollama" | "llama.cpp"
	endpoint: string
	model: string
	timeout: number
	maxTokens: number
	temperature: number
	enableFallback: boolean
	fallbackProvider?: string
}

export interface LocalAIResponse {
	content: string
	model: string
	usage?: {
		promptTokens: number
		completionTokens: number
		totalTokens: number
	}
	timestamp: Date
	processingTime: number
}

export interface LocalAIError {
	error: string
	type: "connection" | "timeout" | "model_not_found" | "rate_limit" | "unknown"
	recoverable: boolean
	suggestion?: string
}

export class LocalAIProvider {
	private config: LocalAIConfig
	private isAvailable: boolean = false
	private lastHealthCheck: Date | null = null

	constructor(config: LocalAIConfig) {
		this.config = config
	}

	async initialize(): Promise<void> {
		await this.checkHealth()
	}

	async checkHealth(): Promise<boolean> {
		try {
			const response = await this.makeRequest("/api/tags", "GET", undefined, 5000)
			this.isAvailable = true
			this.lastHealthCheck = new Date()
			return true
		} catch (error) {
			this.isAvailable = false
			console.warn(`Local AI provider unavailable: ${error}`)
			return false
		}
	}

	async generateResponse(
		prompt: string,
		options?: {
			maxTokens?: number
			temperature?: number
			systemPrompt?: string
		},
	): Promise<LocalAIResponse> {
		if (!this.isAvailable) {
			await this.checkHealth()
			if (!this.isAvailable) {
				throw new Error("Local AI provider is not available")
			}
		}

		const startTime = Date.now()

		try {
			const payload = {
				model: this.config.model,
				prompt,
				system: options?.systemPrompt,
				stream: false,
				options: {
					temperature: options?.temperature ?? this.config.temperature,
					num_predict: options?.maxTokens ?? this.config.maxTokens,
				},
			}

			const response = await this.makeRequest("/api/generate", "POST", payload)
			const processingTime = Date.now() - startTime

			return {
				content: response.response,
				model: this.config.model,
				usage: {
					promptTokens: response.prompt_eval_count || 0,
					completionTokens: response.eval_count || 0,
					totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0),
				},
				timestamp: new Date(),
				processingTime,
			}
		} catch (error) {
			const processingTime = Date.now() - startTime
			throw this.handleError(error, processingTime)
		}
	}

	async generateChatResponse(
		messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
		options?: {
			maxTokens?: number
			temperature?: number
		},
	): Promise<LocalAIResponse> {
		if (!this.isAvailable) {
			await this.checkHealth()
			if (!this.isAvailable) {
				throw new Error("Local AI provider is not available")
			}
		}

		const startTime = Date.now()

		try {
			const payload = {
				model: this.config.model,
				messages,
				stream: false,
				options: {
					temperature: options?.temperature ?? this.config.temperature,
					num_predict: options?.maxTokens ?? this.config.maxTokens,
				},
			}

			const response = await this.makeRequest("/api/chat", "POST", payload)
			const processingTime = Date.now() - startTime

			return {
				content: response.message.content,
				model: this.config.model,
				usage: {
					promptTokens: response.prompt_eval_count || 0,
					completionTokens: response.eval_count || 0,
					totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0),
				},
				timestamp: new Date(),
				processingTime,
			}
		} catch (error) {
			const processingTime = Date.now() - startTime
			throw this.handleError(error, processingTime)
		}
	}

	async listModels(): Promise<string[]> {
		try {
			const response = await this.makeRequest("/api/tags", "GET")
			return response.models.map((model: any) => model.name)
		} catch (error) {
			throw this.handleError(error)
		}
	}

	async pullModel(model: string): Promise<void> {
		try {
			await this.makeRequest("/api/pull", "POST", { name: model })
		} catch (error) {
			throw this.handleError(error)
		}
	}

	async deleteModel(model: string): Promise<void> {
		try {
			await this.makeRequest("/api/delete", "DELETE", { name: model })
		} catch (error) {
			throw this.handleError(error)
		}
	}

	getModelInfo(): { name: string; available: boolean; endpoint: string } {
		return {
			name: this.config.model,
			available: this.isAvailable,
			endpoint: this.config.endpoint,
		}
	}

	updateConfig(config: Partial<LocalAIConfig>): void {
		this.config = { ...this.config, ...config }
	}

	private async makeRequest(
		path: string,
		method: "GET" | "POST" | "DELETE",
		body?: any,
		timeout?: number,
	): Promise<any> {
		const url = `${this.config.endpoint}${path}`
		const requestTimeout = timeout ?? this.config.timeout

		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), requestTimeout)

		try {
			const response = await fetch(url, {
				method,
				headers: {
					"Content-Type": "application/json",
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: controller.signal,
			})

			clearTimeout(timeoutId)

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}))
				throw new Error(`HTTP ${response.status}: ${errorData.error || response.statusText}`)
			}

			return await response.json()
		} catch (error) {
			clearTimeout(timeoutId)
			throw error
		}
	}

	private handleError(error: any, processingTime?: number): LocalAIError {
		if (error.name === "AbortError") {
			return {
				error: "Request timeout",
				type: "timeout",
				recoverable: true,
				suggestion: "Try increasing the timeout or using a smaller prompt",
			}
		}

		if (error.message?.includes("ECONNREFUSED") || error.message?.includes("fetch")) {
			return {
				error: "Connection refused",
				type: "connection",
				recoverable: true,
				suggestion: "Check if Ollama is running and accessible",
			}
		}

		if (error.message?.includes("model not found")) {
			return {
				error: `Model '${this.config.model}' not found`,
				type: "model_not_found",
				recoverable: true,
				suggestion: `Pull the model with: ollama pull ${this.config.model}`,
			}
		}

		return {
			error: error.message || "Unknown error occurred",
			type: "unknown",
			recoverable: false,
		}
	}

	static async createOllamaProvider(
		endpoint: string = "http://localhost:11434",
		model: string = "llama2",
		options?: Partial<LocalAIConfig>,
	): Promise<LocalAIProvider> {
		const config: LocalAIConfig = {
			provider: "ollama",
			endpoint,
			model,
			timeout: 30000,
			maxTokens: 4096,
			temperature: 0.7,
			enableFallback: true,
			...options,
		}

		const provider = new LocalAIProvider(config)
		await provider.initialize()
		return provider
	}

	static async createLlamaCppProvider(
		endpoint: string = "http://localhost:8080",
		model: string = "default",
		options?: Partial<LocalAIConfig>,
	): Promise<LocalAIProvider> {
		const config: LocalAIConfig = {
			provider: "llama.cpp",
			endpoint,
			model,
			timeout: 60000,
			maxTokens: 2048,
			temperature: 0.7,
			enableFallback: true,
			...options,
		}

		const provider = new LocalAIProvider(config)
		await provider.initialize()
		return provider
	}
}

export class LocalAIManager {
	private providers: Map<string, LocalAIProvider> = new Map()
	private defaultProvider: string | null = null
	private privacyMode: boolean = false

	constructor() {}

	async addProvider(name: string, provider: LocalAIProvider): Promise<void> {
		this.providers.set(name, provider)
		if (!this.defaultProvider) {
			this.defaultProvider = name
		}
	}

	async removeProvider(name: string): Promise<void> {
		this.providers.delete(name)
		if (this.defaultProvider === name) {
			this.defaultProvider = this.providers.keys().next().value || null
		}
	}

	getProvider(name?: string): LocalAIProvider | null {
		const providerName = name || this.defaultProvider
		return providerName ? this.providers.get(providerName) || null : null
	}

	async setDefaultProvider(name: string): Promise<void> {
		if (this.providers.has(name)) {
			this.defaultProvider = name
		} else {
			throw new Error(`Provider '${name}' not found`)
		}
	}

	setPrivacyMode(enabled: boolean): void {
		this.privacyMode = enabled
	}

	isPrivacyMode(): boolean {
		return this.privacyMode
	}

	async getAvailableProviders(): Promise<Array<{ name: string; model: string; available: boolean }>> {
		const result = []
		for (const [name, provider] of this.providers) {
			const info = provider.getModelInfo()
			result.push({
				name,
				model: info.name,
				available: info.available,
			})
		}
		return result
	}

	async healthCheck(): Promise<Record<string, boolean>> {
		const result: Record<string, boolean> = {}
		for (const [name, provider] of this.providers) {
			result[name] = await provider.checkHealth()
		}
		return result
	}

	async generateWithFallback(
		prompt: string,
		options?: {
			maxTokens?: number
			temperature?: number
			systemPrompt?: string
			preferredProvider?: string
		},
	): Promise<LocalAIResponse> {
		const providers = this.privacyMode
			? Array.from(this.providers.entries()) // Only use local providers in privacy mode
			: Array.from(this.providers.entries())

		if (providers.length === 0) {
			throw new Error("No AI providers available")
		}

		// Try preferred provider first
		if (options?.preferredProvider && this.providers.has(options.preferredProvider)) {
			try {
				const provider = this.providers.get(options.preferredProvider)!
				return await provider.generateResponse(prompt, options)
			} catch (error) {
				console.warn(`Preferred provider failed:`, error)
			}
		}

		// Try other providers
		for (const [name, provider] of providers) {
			if (name === options?.preferredProvider) continue // Already tried

			try {
				return await provider.generateResponse(prompt, options)
			} catch (error) {
				console.warn(`Provider '${name}' failed:`, error)
				continue
			}
		}

		throw new Error("All AI providers failed")
	}
}

// Singleton instance
export const localAIManager = new LocalAIManager()
