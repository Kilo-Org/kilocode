import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { ZodError } from "zod"

import {
	PROVIDER_SETTINGS_KEYS,
	GLOBAL_SETTINGS_KEYS,
	SECRET_STATE_KEYS,
	GLOBAL_STATE_KEYS,
	type ProviderSettings,
	type GlobalSettings,
	type SecretState,
	type GlobalState,
	type RooCodeSettings,
	providerSettingsSchema,
	globalSettingsSchema,
	isSecretStateKey,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { logger } from "../../utils/logging"

type GlobalStateKey = keyof GlobalState
type SecretStateKey = keyof SecretState
type RooCodeSettingsKey = keyof RooCodeSettings

const PASS_THROUGH_STATE_KEYS: string[] = ["taskHistory"]

const LARGE_STATE_KEYS = ["taskHistory"]

export const isPassThroughStateKey = (key: string) => PASS_THROUGH_STATE_KEYS.includes(key)

const globalSettingsExportSchema = globalSettingsSchema.omit({
	taskHistory: true,
	listApiConfigMeta: true,
	currentApiConfigName: true,
})

export class ContextProxy {
	private readonly originalContext: vscode.ExtensionContext

	private stateCache: GlobalState
	private secretCache: SecretState
	private _isInitialized = false

	// Debounce/coalescing helpers for large on-disk writes
	private largeWriteTimers: Map<string, NodeJS.Timeout> = new Map()
	private largeWritePendingValues: Map<string, any> = new Map()
	private static readonly LARGE_STATE_WRITE_DELAY_MS = 5000

	constructor(context: vscode.ExtensionContext) {
		this.originalContext = context
		this.stateCache = {}
		this.secretCache = {}
		this._isInitialized = false
	}

	public get isInitialized() {
		return this._isInitialized
	}

	public get rawContext(): vscode.ExtensionContext {
		return this.originalContext
	}

	public async initialize() {
		for (const key of GLOBAL_STATE_KEYS) {
			try {
				// If key is large, prefer on-disk read first
				if ((LARGE_STATE_KEYS as string[]).includes(key as unknown as string)) {
					const diskValue = await this.readLargeStateFromDisk(key as unknown as string)
					if (diskValue !== undefined) {
						this.stateCache[key] = diskValue as GlobalState[typeof key]
						continue
					}
				}

				// Fallback to original global state
				this.stateCache[key] = this.originalContext.globalState.get(key)
			} catch (error) {
				logger.error(`Error loading global ${key}: ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		const promises = SECRET_STATE_KEYS.map(async (key) => {
			try {
				this.secretCache[key] = await this.originalContext.secrets.get(key)
			} catch (error) {
				logger.error(`Error loading secret ${key}: ${error instanceof Error ? error.message : String(error)}`)
			}
		})

		await Promise.all(promises)

		this._isInitialized = true
	}

	public get extensionUri() {
		return this.originalContext.extensionUri
	}

	public get extensionPath() {
		return this.originalContext.extensionPath
	}

	public get globalStorageUri() {
		return this.originalContext.globalStorageUri
	}

	public get logUri() {
		return this.originalContext.logUri
	}

	public get extension() {
		return this.originalContext.extension
	}

	public get extensionMode() {
		return this.originalContext.extensionMode
	}

	/**
	 * ExtensionContext.globalState
	 * https://code.visualstudio.com/api/references/vscode-api#ExtensionContext.globalState
	 */

	getGlobalState<K extends GlobalStateKey>(key: K): GlobalState[K]
	getGlobalState<K extends GlobalStateKey>(key: K, defaultValue: GlobalState[K]): GlobalState[K]
	getGlobalState<K extends GlobalStateKey>(key: K, defaultValue?: GlobalState[K]): GlobalState[K] {
		if (isPassThroughStateKey(key)) {
			const value = this.originalContext.globalState.get<GlobalState[K]>(key)
			return value === undefined || value === null ? defaultValue : value
		}

		const value = this.stateCache[key]
		return value !== undefined ? value : defaultValue
	}

	updateGlobalState<K extends GlobalStateKey>(key: K, value: GlobalState[K]) {
		if (isPassThroughStateKey(key)) {
			return this.originalContext.globalState.update(key, value)
		}

		// Capture prior value before we update cache (used for small-key change detection)
		const prev = (this.stateCache as any)[key]

		// update in-memory cache
		this.stateCache[key] = value

		// For very large keys, schedule a debounced write to disk and avoid triggering the full memento write.
		if ((LARGE_STATE_KEYS as string[]).includes(key as unknown as string)) {
			// store pending value and schedule a write
			this.scheduleLargeWrite(key as unknown as string, value)
			// instrument: record that a large key was scheduled for disk write
			void this.appendFragInstrumentLog(
				key as unknown as string,
				this.computeSize(value),
				"updateGlobalState.scheduled",
			)
			return Promise.resolve()
		}

		// instrument: record memento write attempt (size in bytes approx)
		void this.appendFragInstrumentLog(
			key as unknown as string,
			this.computeSize(value),
			"updateGlobalState.memento",
		)

		// default: write to VSCode memento
		return this.originalContext.globalState.update(key, value)
	}

	/**
	 * Update a raw (untyped) global state key. Use this for keys that are not part of RooCodeSettings/GlobalState
	 * (for example extension-specific runtime flags or bookkeeping values). This centralizes writes so we can
	 * avoid expensive memento writes for large values and still support non-typed keys.
	 */
	public async updateRawKey(key: string, value: any): Promise<void> {
		// Keep an in-memory representation when possible for consistency with typed getters.
		try {
			;(this.stateCache as any)[key] = value
		} catch {
			// ignore if assignment fails for unexpected reasons
		}

		// Respect pass-through keys
		if (isPassThroughStateKey(key)) {
			await this.originalContext.globalState.update(key as any, value)
			return
		}

		// Large keys: schedule a debounced disk write
		if ((LARGE_STATE_KEYS as string[]).includes(key)) {
			this.scheduleLargeWrite(key, value)
			// instrument large-disk write scheduled
			void this.appendFragInstrumentLog(key, this.computeSize(value), "updateRawKey.scheduled")
			return
		}

		// instrument: record memento write attempt for raw key
		void this.appendFragInstrumentLog(key, this.computeSize(value), "updateRawKey.memento")

		// Default: write to VSCode memento
		await this.originalContext.globalState.update(key as any, value)
	}

	private getAllGlobalState(): GlobalState {
		return Object.fromEntries(GLOBAL_STATE_KEYS.map((key) => [key, this.getGlobalState(key)]))
	}

	/**
	 * ExtensionContext.secrets
	 * https://code.visualstudio.com/api/references/vscode-api#ExtensionContext.secrets
	 */

	getSecret(key: SecretStateKey) {
		return this.secretCache[key]
	}

	storeSecret(key: SecretStateKey, value?: string) {
		// Update cache.
		this.secretCache[key] = value

		// Write directly to context.
		return value === undefined
			? this.originalContext.secrets.delete(key)
			: this.originalContext.secrets.store(key, value)
	}

	/**
	 * Refresh secrets from storage and update cache
	 * This is useful when you need to ensure the cache has the latest values
	 */
	async refreshSecrets(): Promise<void> {
		const promises = SECRET_STATE_KEYS.map(async (key) => {
			try {
				this.secretCache[key] = await this.originalContext.secrets.get(key)
			} catch (error) {
				logger.error(
					`Error refreshing secret ${key}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		})
		await Promise.all(promises)
	}

	// Read a large state key from disk (globalStorageUri/state/<key>.json). Returns undefined when missing.
	private async readLargeStateFromDisk(key: string): Promise<any | undefined> {
		try {
			const storagePath = this.originalContext.globalStorageUri.fsPath
			const stateDir = path.join(storagePath, "state")
			const filePath = path.join(stateDir, `${key}.json`)
			const data = await fs.readFile(filePath, "utf8")
			return JSON.parse(data)
		} catch (e) {
			// missing file or parse error => undefined
			return undefined
		}
	}

	// Atomically write large state to disk using tmp file + rename
	private async writeLargeStateToDisk(key: string, value: any): Promise<void> {
		try {
			const storagePath = this.originalContext.globalStorageUri.fsPath
			const stateDir = path.join(storagePath, "state")
			await fs.mkdir(stateDir, { recursive: true })
			const filePath = path.join(stateDir, `${key}.json`)
			const tmpPath = path.join(stateDir, `${key}.json.tmp`)
			const data = JSON.stringify(value, null, 2)
			await fs.writeFile(tmpPath, data, "utf8")
			await fs.rename(tmpPath, filePath)
		} catch (err) {
			logger.error(
				`Failed to write large state '${key}' to disk: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}

	// Delete large state file if exists
	private async deleteLargeStateFile(key: string): Promise<void> {
		try {
			const storagePath = this.originalContext.globalStorageUri.fsPath
			const filePath = path.join(storagePath, "state", `${key}.json`)
			await fs.unlink(filePath).catch(() => {})
		} catch {
			// ignore
		}
	}

	// Schedule/coalesce writes for very large keys to reduce disk churn and memento pressure.
	private scheduleLargeWrite(key: string, value: any) {
		try {
			this.largeWritePendingValues.set(key, value)
			const existing = this.largeWriteTimers.get(key)
			if (existing) {
				clearTimeout(existing)
			}
			const timer = setTimeout(async () => {
				const pending = this.largeWritePendingValues.get(key)
				if (pending !== undefined) {
					await this.writeLargeStateToDisk(key, pending)
					void this.appendFragInstrumentLog(key, this.computeSize(pending), "scheduleLargeWrite.flush")
					this.largeWritePendingValues.delete(key)
				}
				this.largeWriteTimers.delete(key)
			}, ContextProxy.LARGE_STATE_WRITE_DELAY_MS)
			this.largeWriteTimers.set(key, timer)
		} catch (err) {
			// swallow errors from scheduling
		}
	}

	// Append instrumentation log (durable) for frag testing. Writes JSON lines to globalStorage/state/frag-instrument.log
	private computeSize(value: any): number {
		try {
			const s = JSON.stringify(value)
			return s ? s.length : 0
		} catch {
			return 0
		}
	}

	private async appendFragInstrumentLog(key: string, size: number, via: string): Promise<void> {
		try {
			const storagePath = this.originalContext.globalStorageUri.fsPath
			const stateDir = path.join(storagePath, "state")
			await fs.mkdir(stateDir, { recursive: true })
			const logPath = path.join(stateDir, "frag-instrument.log")
			const stack = (new Error().stack || "")
				.split("\n")
				.slice(2, 8)
				.map((s) => s.trim())
				.join(" | ")
			const entry = JSON.stringify({ ts: new Date().toISOString(), key, size, via, stack }) + "\n"
			// append to file
			await fs.appendFile(logPath, entry, "utf8")
		} catch (err) {
			// ignore logging failure
		}
	}

	private getAllSecretState(): SecretState {
		return Object.fromEntries(SECRET_STATE_KEYS.map((key) => [key, this.getSecret(key)]))
	}

	// kilocode_change start
	/**
	 * WorkspaceState
	 */
	async updateWorkspaceState(context: vscode.ExtensionContext, key: string, value: any) {
		await context.workspaceState.update(key, value)
	}

	async getWorkspaceState(context: vscode.ExtensionContext, key: string) {
		return await context.workspaceState.get(key)
	}
	// kilocode_change end

	/**
	 * GlobalSettings
	 */

	public getGlobalSettings(): GlobalSettings {
		const values = this.getValues()

		try {
			return globalSettingsSchema.parse(values)
		} catch (error) {
			if (error instanceof ZodError) {
				TelemetryService.instance.captureSchemaValidationError({ schemaName: "GlobalSettings", error })
			}

			return GLOBAL_SETTINGS_KEYS.reduce((acc, key) => ({ ...acc, [key]: values[key] }), {} as GlobalSettings)
		}
	}

	/**
	 * ProviderSettings
	 */

	public getProviderSettings(): ProviderSettings {
		const values = this.getValues()

		try {
			return providerSettingsSchema.parse(values)
		} catch (error) {
			if (error instanceof ZodError) {
				TelemetryService.instance.captureSchemaValidationError({ schemaName: "ProviderSettings", error })
			}

			return PROVIDER_SETTINGS_KEYS.reduce((acc, key) => ({ ...acc, [key]: values[key] }), {} as ProviderSettings)
		}
	}

	public async setProviderSettings(values: ProviderSettings) {
		// Explicitly clear out any old API configuration values before that
		// might not be present in the new configuration.
		// If a value is not present in the new configuration, then it is assumed
		// that the setting's value should be `undefined` and therefore we
		// need to remove it from the state cache if it exists.

		// Ensure openAiHeaders is always an object even when empty
		// This is critical for proper serialization/deserialization through IPC
		if (values.openAiHeaders !== undefined) {
			// Check if it's empty or null
			if (!values.openAiHeaders || Object.keys(values.openAiHeaders).length === 0) {
				values.openAiHeaders = {}
			}
		}

		await this.setValues({
			...PROVIDER_SETTINGS_KEYS.filter((key) => !isSecretStateKey(key))
				.filter((key) => !!this.stateCache[key])
				.reduce((acc, key) => ({ ...acc, [key]: undefined }), {} as ProviderSettings),
			...values,
		})
	}

	/**
	 * RooCodeSettings
	 */

	public setValue<K extends RooCodeSettingsKey>(key: K, value: RooCodeSettings[K]) {
		return isSecretStateKey(key) ? this.storeSecret(key, value as string) : this.updateGlobalState(key, value)
	}

	public getValue<K extends RooCodeSettingsKey>(key: K): RooCodeSettings[K] {
		return isSecretStateKey(key)
			? (this.getSecret(key) as RooCodeSettings[K])
			: (this.getGlobalState(key) as RooCodeSettings[K])
	}

	public getValues(): RooCodeSettings {
		return { ...this.getAllGlobalState(), ...this.getAllSecretState() }
	}

	public async setValues(values: RooCodeSettings) {
		const entries = Object.entries(values) as [RooCodeSettingsKey, unknown][]
		await Promise.all(entries.map(([key, value]) => this.setValue(key, value)))
	}

	/**
	 * Import / Export
	 */

	public async export(): Promise<GlobalSettings | undefined> {
		try {
			const globalSettings = globalSettingsExportSchema.parse(this.getValues())

			// Exports should only contain global settings, so this skips project custom modes (those exist in the .roomode folder)
			globalSettings.customModes = globalSettings.customModes?.filter((mode) => mode.source === "global")

			return Object.fromEntries(Object.entries(globalSettings).filter(([_, value]) => value !== undefined))
		} catch (error) {
			if (error instanceof ZodError) {
				TelemetryService.instance.captureSchemaValidationError({ schemaName: "GlobalSettings", error })
			}

			return undefined
		}
	}

	/**
	 * Resets all global state, secrets, and in-memory caches.
	 * This clears all data from both the in-memory caches and the VSCode storage.
	 * @returns A promise that resolves when all reset operations are complete
	 */
	public async resetAllState() {
		// Clear in-memory caches
		this.stateCache = {}
		this.secretCache = {}

		const promises: Promise<any>[] = []
		for (const key of GLOBAL_STATE_KEYS) {
			if ((LARGE_STATE_KEYS as string[]).includes(key as unknown as string)) {
				// Ensure a proper Promise<any> is pushed (avoid Thenable typing issues)
				promises.push(Promise.resolve(this.deleteLargeStateFile(key as unknown as string).catch(() => {})))
			} else {
				promises.push(Promise.resolve(this.originalContext.globalState.update(key, undefined)))
			}
		}
		promises.push(
			...SECRET_STATE_KEYS.map((key) =>
				Promise.resolve(this.originalContext.secrets.delete(key) as Promise<any>),
			),
		)

		await Promise.all(promises)

		await this.initialize()
	}

	private static _instance: ContextProxy | null = null

	static get instance() {
		if (!this._instance) {
			throw new Error("ContextProxy not initialized")
		}

		return this._instance
	}

	static async getInstance(context: vscode.ExtensionContext) {
		if (this._instance) {
			return this._instance
		}

		this._instance = new ContextProxy(context)
		await this._instance.initialize()

		return this._instance
	}
}
