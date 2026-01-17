import { config } from "dotenv"
import { existsSync } from "fs"
import { join } from "path"

// __dirname is provided by the banner in the bundled output
declare const __dirname: string

/**
 * Loads the .env file from the dist directory (where binaries are located)
 * The .env file is optional - users can configure via KILO_* environment variables instead
 */
export function loadEnvFile(): void {
	// In bundled output, __dirname points to the dist directory where index.js is located
	// The .env file should be in the same directory
	const envPath = join(__dirname, ".env")

	// .env is optional - users can configure via KILO_* environment variables instead
	if (!existsSync(envPath)) {
		return
	}

	// Load the .env file
	const result = config({ path: envPath })

	// If .env exists but has parsing errors, report the error
	if (result.error) {
		console.error(`Error loading .env file: ${result.error.message}`)
		process.exit(1)
	}
}
