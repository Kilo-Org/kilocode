import {
	type SettingsService,
	type UserFeatures,
	type UserSettingsConfig,
	type UserSettingsData,
	OrganizationAllowList,
	OrganizationSettings,
	organizationSettingsSchema,
	ORGANIZATION_ALLOW_ALL,
} from "@roo-code/types"
import { ZodError } from "zod"

export class StaticSettingsService implements SettingsService {
	private settings: OrganizationSettings
	private log: (...args: unknown[]) => void

	constructor(envValue: string, log?: (...args: unknown[]) => void) {
		this.log = log || console.log
		this.settings = this.parseEnvironmentSettings(envValue)
	}

	private parseEnvironmentSettings(envValue: string): OrganizationSettings {
		if (!envValue || typeof envValue !== "string") {
			return this.logAndThrow("Failed to parse static settings", new Error("Missing static settings value")) // kilocode_change
		}

		let decodedValue: string // kilocode_change
		try {
			decodedValue = Buffer.from(envValue, "base64").toString("utf-8")
		} catch (error) {
			return this.logAndThrow("Failed to parse static settings", error) // kilocode_change
		}

		let parsedJson: unknown // kilocode_change
		try {
			parsedJson = JSON.parse(decodedValue)
		} catch (error) {
			return this.logAndThrow("Failed to parse static settings", error) // kilocode_change
		}

		let parsed // kilocode_change
		try {
			parsed = organizationSettingsSchema.safeParse(parsedJson) // kilocode_change
		} catch (error) {
			return this.logAndThrow("Failed to parse static settings", error) // kilocode_change
		}

		if (!parsed.success) {
			return this.logAndThrow("Failed to parse static settings", parsed.error) // kilocode_change
		}

		return parsed.data // kilocode_change
	}

	private logAndThrow(message: string, error: unknown): never {
		const err = error instanceof Error ? error : new Error(String(error)) // kilocode_change
		const safeMessage = err instanceof ZodError ? "Invalid static settings schema" : err.message // kilocode_change
		const loggableError = new Error(safeMessage) // kilocode_change
		this.log(`[StaticSettingsService] failed to parse static settings: ${safeMessage}`, loggableError) // kilocode_change
		throw new Error(message, { cause: err }) // kilocode_change
	}

	public getAllowList(): OrganizationAllowList {
		return this.settings?.allowList || ORGANIZATION_ALLOW_ALL
	}

	public getSettings(): OrganizationSettings | undefined {
		return this.settings
	}

	/**
	 * Returns static user settings with roomoteControlEnabled and extensionBridgeEnabled as true
	 */
	public getUserSettings(): UserSettingsData | undefined {
		return {
			features: {
				roomoteControlEnabled: true,
			},
			settings: {
				extensionBridgeEnabled: true,
				taskSyncEnabled: true,
			},
			version: 1,
		}
	}

	public getUserFeatures(): UserFeatures {
		return {
			roomoteControlEnabled: true,
		}
	}

	public getUserSettingsConfig(): UserSettingsConfig {
		return {
			extensionBridgeEnabled: true,
			taskSyncEnabled: true,
		}
	}

	public async updateUserSettings(_settings: Partial<UserSettingsConfig>): Promise<boolean> {
		throw new Error("User settings updates are not supported in static mode")
	}

	public isTaskSyncEnabled(): boolean {
		// Static settings always enable task sync
		return true
	}

	public dispose(): void {
		// No resources to clean up for static settings.
	}
}
