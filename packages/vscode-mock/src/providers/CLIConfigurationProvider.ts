import * as fs from "fs/promises"
import * as path from "path"
import type {
	IConfiguration,
	ConfigurationChangeEvent,
	ConfigurationChangeCallback,
	ConfigurationWatcher,
	ConfigurationSchema,
	ConfigurationValidationResult,
	ConfigurationMetadata,
} from "../types"
import { ConfigurationScope, ConfigurationFormat } from "../types"

interface ExtendedConfigurationWatcher extends ConfigurationWatcher {
	key?: string
	callback?: ConfigurationChangeCallback
}

/**
 * CLI implementation of the IConfiguration interface using file-based storage.
 * Provides comprehensive configuration management for command-line environments.
 */
export class CLIConfigurationProvider implements IConfiguration {
	private config: Record<string, any> = {}
	private watchers = new Map<string, ExtendedConfigurationWatcher>()
	private configPaths: string[] = []
	private readonly configName: string

	constructor(configName: string = "kilocode") {
		this.configName = configName
	}

	async initialize(): Promise<void> {
		try {
			const configPath = this.getConfigPath(ConfigurationScope.User)
			const content = await fs.readFile(configPath, "utf8")
			this.config = JSON.parse(content)
			this.configPaths = [configPath]
		} catch (error) {
			// Config file not found or invalid, start with empty config
			this.config = {}
		}

		// Load environment variables
		this.loadEnvironmentVariables()
	}

	get<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.getNestedValue(this.config, key)
		return value !== undefined ? value : defaultValue
	}

	async set<T>(key: string, value: T, scope: ConfigurationScope = ConfigurationScope.User): Promise<void> {
		this.setNestedValue(this.config, key, value)
		await this.saveConfig(scope)
		this.notifyWatchers(key, undefined, value, scope)
	}

	has(key: string): boolean {
		return this.getNestedValue(this.config, key) !== undefined
	}

	async remove(key: string, scope: ConfigurationScope = ConfigurationScope.User): Promise<void> {
		const oldValue = this.getNestedValue(this.config, key)
		this.deleteNestedValue(this.config, key)
		await this.saveConfig(scope)
		this.notifyWatchers(key, oldValue, undefined, scope)
	}

	getSection(section?: string): Record<string, any> {
		if (!section) {
			return { ...this.config }
		}
		return this.getNestedValue(this.config, section) || {}
	}

	async update(values: Record<string, any>, scope: ConfigurationScope = ConfigurationScope.User): Promise<void> {
		const changes: Array<{ key: string; oldValue: any; newValue: any }> = []

		for (const [key, value] of Object.entries(values)) {
			const oldValue = this.getNestedValue(this.config, key)
			this.setNestedValue(this.config, key, value)
			changes.push({ key, oldValue, newValue: value })
		}

		await this.saveConfig(scope)

		// Notify watchers of all changes
		for (const change of changes) {
			this.notifyWatchers(change.key, change.oldValue, change.newValue, scope)
		}
	}

	async reset(section?: string, scope: ConfigurationScope = ConfigurationScope.User): Promise<void> {
		if (section) {
			const oldValue = this.getNestedValue(this.config, section)
			this.deleteNestedValue(this.config, section)
			this.notifyWatchers(section, oldValue, undefined, scope)
		} else {
			this.config = {}
		}
		await this.saveConfig(scope)
	}

	watch(key: string | undefined, callback: ConfigurationChangeCallback): ConfigurationWatcher {
		const watcherId = `${key || "*"}-${Date.now()}`
		const watcher: ExtendedConfigurationWatcher = {
			dispose: () => {
				this.watchers.delete(watcherId)
			},
			key,
			callback,
		}

		this.watchers.set(watcherId, watcher)
		return watcher
	}

	getEnv(key: string, defaultValue?: string): string | undefined {
		return process.env[key] || defaultValue
	}

	async setEnv(key: string, value: string): Promise<void> {
		process.env[key] = value
	}

	getAllEnv(): Record<string, string> {
		return { ...process.env } as Record<string, string>
	}

	async loadFromFile(filePath: string, format?: ConfigurationFormat): Promise<void> {
		const content = await fs.readFile(filePath, "utf8")
		const detectedFormat = format || this.detectFormat(filePath)

		let parsedConfig: any
		switch (detectedFormat) {
			case ConfigurationFormat.JSON:
				parsedConfig = JSON.parse(content)
				break
			case ConfigurationFormat.YAML:
				// Simple YAML parsing for basic cases
				parsedConfig = this.parseSimpleYaml(content)
				break
			case ConfigurationFormat.ENV:
				parsedConfig = this.parseEnvFile(content)
				break
			default:
				throw new Error(`Unsupported configuration format: ${detectedFormat}`)
		}

		this.config = { ...this.config, ...parsedConfig }
		if (!this.configPaths.includes(filePath)) {
			this.configPaths.push(filePath)
		}
	}

	async saveToFile(filePath: string, format?: ConfigurationFormat, section?: string): Promise<void> {
		const dataToSave = section ? this.getSection(section) : this.config
		const detectedFormat = format || this.detectFormat(filePath)

		let content: string
		switch (detectedFormat) {
			case ConfigurationFormat.JSON:
				content = JSON.stringify(dataToSave, null, 2)
				break
			case ConfigurationFormat.YAML:
				content = this.stringifySimpleYaml(dataToSave)
				break
			case ConfigurationFormat.ENV:
				content = this.stringifyEnvFile(dataToSave)
				break
			default:
				throw new Error(`Unsupported configuration format: ${detectedFormat}`)
		}

		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, content, "utf8")
	}

	getConfigPaths(): string[] {
		return [...this.configPaths]
	}

	async reload(): Promise<void> {
		await this.initialize()
	}

	validate(schema: ConfigurationSchema, section?: string): ConfigurationValidationResult {
		const dataToValidate = section ? this.getSection(section) : this.config
		const errors: any[] = []
		const warnings: any[] = []

		// Basic validation implementation
		for (const [key, property] of Object.entries(schema.properties)) {
			const value = this.getNestedValue(dataToValidate, key)

			if (schema.required?.includes(key) && value === undefined) {
				errors.push({
					key,
					message: `Required property '${key}' is missing`,
					value: undefined,
				})
			}

			if (value !== undefined && !this.validateProperty(value, property)) {
				errors.push({
					key,
					message: `Property '${key}' has invalid type or value`,
					value,
				})
			}
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
		}
	}

	getMetadata(key: string): ConfigurationMetadata | undefined {
		const value = this.getNestedValue(this.config, key)
		if (value === undefined) {
			return undefined
		}

		return {
			type: typeof value,
			scope: ConfigurationScope.User,
			readOnly: false,
		}
	}

	isReadOnly(key: string): boolean {
		return false
	}

	/**
	 * Get nested value from object using dot notation.
	 */
	private getNestedValue(obj: any, key: string): any {
		return key.split(".").reduce((current, prop) => current?.[prop], obj)
	}

	/**
	 * Set nested value in object using dot notation.
	 */
	private setNestedValue(obj: any, key: string, value: any): void {
		const keys = key.split(".")
		const lastKey = keys.pop()!
		const target = keys.reduce((current, prop) => {
			if (!(prop in current)) {
				current[prop] = {}
			}
			return current[prop]
		}, obj)
		target[lastKey] = value
	}

	/**
	 * Delete nested value from object using dot notation.
	 */
	private deleteNestedValue(obj: any, key: string): void {
		const keys = key.split(".")
		const lastKey = keys.pop()!
		const target = keys.reduce((current, prop) => current?.[prop], obj)
		if (target) {
			delete target[lastKey]
		}
	}

	/**
	 * Save configuration to file.
	 */
	private async saveConfig(scope: ConfigurationScope): Promise<void> {
		const configPath = this.getConfigPath(scope)
		await this.saveToFile(configPath, ConfigurationFormat.JSON)
	}

	/**
	 * Get configuration file path for scope.
	 */
	private getConfigPath(scope: ConfigurationScope): string {
		switch (scope) {
			case ConfigurationScope.Global:
				return path.join(process.env.HOME || process.env.USERPROFILE || ".", `.${this.configName}rc.json`)
			case ConfigurationScope.Workspace:
				return path.join(process.cwd(), `.${this.configName}rc.json`)
			case ConfigurationScope.User:
			default:
				return path.join(process.env.HOME || process.env.USERPROFILE || ".", `.${this.configName}rc.json`)
		}
	}

	/**
	 * Detect configuration format from file extension.
	 */
	private detectFormat(filePath: string): ConfigurationFormat {
		const ext = path.extname(filePath).toLowerCase()
		switch (ext) {
			case ".yaml":
			case ".yml":
				return ConfigurationFormat.YAML
			case ".env":
				return ConfigurationFormat.ENV
			case ".json":
			default:
				return ConfigurationFormat.JSON
		}
	}

	/**
	 * Parse simple YAML content (basic key-value pairs).
	 */
	private parseSimpleYaml(content: string): Record<string, any> {
		const result: Record<string, any> = {}
		const lines = content.split("\n")

		for (const line of lines) {
			const trimmed = line.trim()
			if (trimmed && !trimmed.startsWith("#")) {
				const colonIndex = trimmed.indexOf(":")
				if (colonIndex > 0) {
					const key = trimmed.slice(0, colonIndex).trim()
					const value = trimmed.slice(colonIndex + 1).trim()
					result[key] = this.parseYamlValue(value)
				}
			}
		}

		return result
	}

	/**
	 * Parse YAML value (basic types).
	 */
	private parseYamlValue(value: string): any {
		if (value === "true") return true
		if (value === "false") return false
		if (value === "null") return null
		if (/^\d+$/.test(value)) return parseInt(value, 10)
		if (/^\d+\.\d+$/.test(value)) return parseFloat(value)
		if (value.startsWith('"') && value.endsWith('"')) {
			return value.slice(1, -1)
		}
		return value
	}

	/**
	 * Stringify object to simple YAML format.
	 */
	private stringifySimpleYaml(obj: Record<string, any>): string {
		return Object.entries(obj)
			.map(([key, value]) => `${key}: ${this.stringifyYamlValue(value)}`)
			.join("\n")
	}

	/**
	 * Stringify value to YAML format.
	 */
	private stringifyYamlValue(value: any): string {
		if (typeof value === "string") {
			return `"${value}"`
		}
		return String(value)
	}

	/**
	 * Parse environment file content.
	 */
	private parseEnvFile(content: string): Record<string, string> {
		const result: Record<string, string> = {}
		const lines = content.split("\n")

		for (const line of lines) {
			const trimmed = line.trim()
			if (trimmed && !trimmed.startsWith("#")) {
				const [key, ...valueParts] = trimmed.split("=")
				if (key && valueParts.length > 0) {
					result[key.trim()] = valueParts.join("=").trim()
				}
			}
		}

		return result
	}

	/**
	 * Stringify object to environment file format.
	 */
	private stringifyEnvFile(obj: Record<string, any>): string {
		return Object.entries(obj)
			.map(([key, value]) => `${key}=${value}`)
			.join("\n")
	}

	/**
	 * Load environment variables into configuration.
	 */
	private loadEnvironmentVariables(): void {
		const envPrefix = `${this.configName.toUpperCase()}_`
		for (const [key, value] of Object.entries(process.env)) {
			if (key.startsWith(envPrefix)) {
				const configKey = key.slice(envPrefix.length).toLowerCase().replace(/_/g, ".")
				this.setNestedValue(this.config, configKey, value)
			}
		}
	}

	/**
	 * Validate property against schema.
	 */
	private validateProperty(value: any, property: any): boolean {
		const actualType = Array.isArray(value) ? "array" : typeof value
		if (property.type && property.type !== actualType) {
			return false
		}

		if (property.enum && !property.enum.includes(value)) {
			return false
		}

		if (typeof value === "number") {
			if (property.minimum !== undefined && value < property.minimum) {
				return false
			}
			if (property.maximum !== undefined && value > property.maximum) {
				return false
			}
		}

		return true
	}

	/**
	 * Notify configuration watchers of changes.
	 */
	private notifyWatchers(key: string, oldValue: any, newValue: any, scope: ConfigurationScope): void {
		const event: ConfigurationChangeEvent = {
			key,
			oldValue,
			newValue,
			scope,
		}

		for (const watcher of this.watchers.values()) {
			if (!watcher.key || watcher.key === key || key.startsWith(watcher.key + ".")) {
				watcher.callback?.(event)
			}
		}
	}

	/**
	 * Dispose all watchers and clean up resources.
	 */
	dispose(): void {
		for (const watcher of this.watchers.values()) {
			watcher.dispose()
		}
		this.watchers.clear()
	}
}
