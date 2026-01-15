import { config } from "dotenv"
import { existsSync } from "fs"
import { join } from "path"

// __dirname is provided by the banner in the bundled output
declare const __dirname: string

/**
 * Loads the .env file from the dist directory (where binaries are located)
 * Throws an error if the .env file doesn't exist
 */
export function loadEnvFile(): void {
	// In bundled output, __dirname points to the dist directory where index.js is located
	// The .env file should be in the same directory
	const envPath = join(__dirname, ".env")

	// Check if .env file exists
	if (!existsSync(envPath)) {
		// It's okay if .env doesn't exist, we might be running in a production environment
		// or relying on system environment variables
		return
	}

	// Load the .env file
	const result = config({ path: envPath })

	if (result.error) {
		console.error(`Error loading .env file: ${result.error.message}`)
		process.exit(1)
	}
}
