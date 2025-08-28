import { ExtensionContext } from "vscode"
import { ProviderProfiles } from "../ProviderSettingsManager"

export async function migrateMorphApiKey(context: ExtensionContext, providerProfiles: ProviderProfiles) {
	let isDirty = false
	try {
		// Find any provider profile with morphApiKey set
		let morphApiKeyToMigrate: string | undefined

		for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
			// Check if this config has morphApiKey (using type assertion since it's no longer in the schema)
			const configAny = apiConfig as any
			if (configAny.morphApiKey) {
				morphApiKeyToMigrate = configAny.morphApiKey
				// Clear it from the provider config
				delete configAny.morphApiKey
				break // Use the first one found
			}
		}

		// If we found a morphApiKey, migrate it to global settings
		if (morphApiKeyToMigrate) {
			try {
				await context.globalState.update("morphApiKey", morphApiKeyToMigrate)
				isDirty = true
				console.log("[MigrateMorphApiKey] Successfully migrated morphApiKey to global settings")
			} catch (error) {
				console.error("[MigrateMorphApiKey] Error setting global morphApiKey:", error)
			}
		}
	} catch (error) {
		console.error(`[MigrateMorphApiKey] Failed to migrate morphApiKey:`, error)
	}
	return isDirty
}
