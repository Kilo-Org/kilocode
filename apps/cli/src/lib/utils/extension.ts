import path from "path"
import fs from "fs"

/**
 * Get the default path to the extension bundle.
 * This assumes the CLI is installed alongside the built extension.
 *
 * @param dirname - The __dirname equivalent for the calling module
 */
export function getDefaultExtensionPath(dirname: string): string {
	// Check for environment variable first (set by install script)
	if (process.env.ROO_EXTENSION_PATH) {
		const envPath = process.env.ROO_EXTENSION_PATH

		if (fs.existsSync(path.join(envPath, "extension.js"))) {
			return envPath
		}
	}

	// __dirname is apps/cli/dist when bundled
	// The extension is at src/dist (relative to monorepo root)
	// So from apps/cli/dist, we need to go ../../../src/dist
	const monorepoPath = path.resolve(dirname, "../../../src/dist")

	// Try monorepo path first (for development)
	if (fs.existsSync(path.join(monorepoPath, "extension.js"))) {
		return monorepoPath
	}

	// Fallback: when installed via curl script, extension is at ../extension
	const packagePath = path.resolve(dirname, "../extension")
	return packagePath
}
