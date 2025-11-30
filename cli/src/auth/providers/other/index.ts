import type { AuthProvider, AuthResult } from "../../types.js"
import openConfigFile from "../../../config/openConfig.js"
import wait from "../../../utils/wait.js"

/**
 * Manual configuration provider
 * Opens the config file for manual editing
 */
async function authenticateManually(): Promise<AuthResult> {
	console.log("\nPlease manually add your provider settings to the config file.")
	console.log(
		"Check out https://github.com/Kilo-Org/kilocode/blob/main/cli/docs/PROVIDER_CONFIGURATION.md to see potential configuration options",
	)
	await wait(1500)

	try {
		await openConfigFile()
	} catch (_error) {
		// Error already logged by openConfigFile
		console.log("\nPlease manually edit the config file and restart the CLI.")
	}

	// Manual configuration complete - show success message and exit
	console.log("\n✓ Config file opened successfully!")
	console.log("Please restart the CLI after editing the configuration file.\n")
	process.exit(0)
}

/**
 * Other provider for manual configuration
 */
export const otherProvider: AuthProvider = {
	name: "Other (Manual configuration)",
	value: "other",
	authenticate: authenticateManually,
}
