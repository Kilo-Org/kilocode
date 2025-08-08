import * as fs from "fs"
import * as path from "path"

/**
 * Simple CLI configuration management
 */
export interface ConfigData {
	provider?: string
	model?: string
	apiKey?: string
	baseUrl?: string
	maxTokens?: number
	temperature?: number
	[key: string]: any
}

/**
 * Simple CLI configuration class
 */
export class CLIConfig {
	private config: ConfigData = {}
	private configPath: string
	private workingDirectory: string

	constructor(configPath?: string, workingDirectory?: string) {
		this.workingDirectory = workingDirectory || process.cwd()
		this.configPath = configPath || path.join(this.workingDirectory, ".kilo-config.json")
	}

	async loadDefaults(): Promise<void> {
		// Load .env file if it exists
		this.loadDotEnv()

		// Set default configuration for OpenRouter
		this.config = {
			provider: "openrouter",
			model: "anthropic/claude-sonnet-4", // Use Claude Sonnet 4 as requested
			baseUrl: "https://openrouter.ai/api/v1",
			maxTokens: 8192,
			temperature: 0,
			...this.config,
		}

		// Try to load from file if it exists
		if (fs.existsSync(this.configPath)) {
			try {
				const fileContent = fs.readFileSync(this.configPath, "utf8")
				const fileConfig = JSON.parse(fileContent)
				this.config = { ...this.config, ...fileConfig }
			} catch (error) {
				console.warn(`Failed to load config from ${this.configPath}:`, error)
			}
		}

		// General configuration from environment variables (these can override provider)
		if (process.env.KILO_PROVIDER) {
			this.config.provider = process.env.KILO_PROVIDER
		}
		if (process.env.KILO_MODEL) {
			this.config.model = process.env.KILO_MODEL
		}
		if (process.env.KILO_API_KEY) {
			this.config.apiKey = process.env.KILO_API_KEY
		}
		if (process.env.KILO_BASE_URL) {
			this.config.baseUrl = process.env.KILO_BASE_URL
		}
		if (process.env.KILO_MAX_TOKENS) {
			this.config.maxTokens = parseInt(process.env.KILO_MAX_TOKENS, 10)
		}
		if (process.env.KILO_TEMPERATURE) {
			this.config.temperature = parseFloat(process.env.KILO_TEMPERATURE)
		}

		// Load API key based on the configured provider (after all other config is loaded)
		if (!this.config.apiKey) {
			switch (this.config.provider) {
				case "openrouter":
					if (process.env.OPENROUTER_API_KEY) {
						this.config.apiKey = process.env.OPENROUTER_API_KEY
					}
					break
				case "anthropic":
					if (process.env.ANTHROPIC_API_KEY) {
						this.config.apiKey = process.env.ANTHROPIC_API_KEY
					}
					break
				case "openai":
					if (process.env.OPENAI_API_KEY) {
						this.config.apiKey = process.env.OPENAI_API_KEY
					}
					break
				case "google":
					if (process.env.GOOGLE_API_KEY) {
						this.config.apiKey = process.env.GOOGLE_API_KEY
					}
					break
			}
		}
	}

	/**
	 * Load environment variables from .env file
	 */
	private loadDotEnv(): void {
		const envPath = path.join(this.workingDirectory, ".env")
		if (fs.existsSync(envPath)) {
			try {
				const envContent = fs.readFileSync(envPath, "utf8")
				const envLines = envContent.split("\n")

				for (const line of envLines) {
					const trimmedLine = line.trim()
					if (trimmedLine && !trimmedLine.startsWith("#")) {
						const [key, ...valueParts] = trimmedLine.split("=")
						if (key && valueParts.length > 0) {
							const value = valueParts.join("=").replace(/^["']|["']$/g, "")
							if (!process.env[key]) {
								process.env[key] = value
							}
						}
					}
				}
				console.log(`[DEBUG] Loaded environment variables from ${envPath}`)
			} catch (error) {
				console.warn(`Failed to load .env file from ${envPath}:`, error)
			}
		}
	}

	async loadFromFile(filePath: string): Promise<void> {
		try {
			const fileContent = fs.readFileSync(filePath, "utf8")
			const fileConfig = JSON.parse(fileContent)
			this.config = { ...this.config, ...fileConfig }
		} catch (error) {
			throw new Error(`Failed to load config from ${filePath}: ${error}`)
		}
	}

	async save(): Promise<void> {
		try {
			const configDir = path.dirname(this.configPath)
			if (!fs.existsSync(configDir)) {
				fs.mkdirSync(configDir, { recursive: true })
			}
			fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
		} catch (error) {
			throw new Error(`Failed to save config to ${this.configPath}: ${error}`)
		}
	}

	get(key: string): any {
		return this.config[key]
	}

	async set(key: string, value: any): Promise<void> {
		this.config[key] = value
	}

	getAll(): ConfigData {
		return { ...this.config }
	}

	has(key: string): boolean {
		return key in this.config
	}

	async delete(key: string): Promise<void> {
		delete this.config[key]
	}

	merge(newData: Partial<ConfigData>): void {
		this.config = { ...this.config, ...newData }
	}

	validate(): string[] {
		const errors: string[] = []

		if (!this.config.provider) {
			errors.push("Provider is required")
		}

		// Check API key requirements for different providers
		const providersRequiringApiKey = ["anthropic", "openai", "google", "azure", "cohere", "openrouter"]
		if (this.config.provider && providersRequiringApiKey.includes(this.config.provider) && !this.config.apiKey) {
			errors.push(`API key is required for ${this.config.provider} provider`)
		}

		// Validate numeric values
		if (
			this.config.maxTokens !== undefined &&
			(this.config.maxTokens <= 0 || !Number.isInteger(this.config.maxTokens))
		) {
			errors.push("maxTokens must be a positive integer")
		}

		if (this.config.temperature !== undefined && (this.config.temperature < 0 || this.config.temperature > 2)) {
			errors.push("temperature must be between 0 and 2")
		}

		return errors
	}
}
