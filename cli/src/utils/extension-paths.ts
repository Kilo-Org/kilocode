import * as path from "path"
import { fileURLToPath } from "url"
import { existsSync } from "fs"

export interface ExtensionPaths {
	extensionBundlePath: string // Path to extension.js
	extensionRootPath: string // Path to extension root
}

/**
 * Resolves extension paths for CLI.
 *
 * In development mode (KILOCODE_DEV_CLI_PATH is set):
 * - Uses src/dist/extension.js directly from the source workspace
 * - This avoids the need to copy the extension to cli/dist/kilocode/
 * - KILOCODE_DEV_CLI_PATH is set by launch.json and inherited by spawned CLI
 *
 * In production mode (npm installed CLI):
 * - Uses cli/dist/kilocode/dist/extension.js (bundled with CLI)
 *
 * Production structure:
 * cli/dist/
 * ├── index.js
 * ├── cli/KiloCodeCLI.js
 * ├── host/ExtensionHost.js
 * ├── utils/extension-paths.js (this file)
 * └── kilocode/
 *     ├── dist/extension.js
 *     ├── assets/
 *     └── webview-ui/
 */
export function resolveExtensionPaths(): ExtensionPaths {
	// Get the directory where this compiled file is located
	const currentFile = fileURLToPath(import.meta.url)
	const currentDir = path.dirname(currentFile)

	// When bundled with esbuild, all code is in dist/index.js
	// When compiled with tsc, this file is in dist/utils/extension-paths.js
	// Check if we're in a utils subdirectory or directly in dist
	const isInUtilsSubdir = currentDir.endsWith("utils")

	// Navigate to dist directory (cli/dist/)
	const distDir = isInUtilsSubdir ? path.resolve(currentDir, "..") : currentDir

	// Development mode: KILOCODE_DEV_CLI_PATH is set by launch.json
	// This is the canonical way to detect dev mode - the extension spawns CLI
	// with this env var inherited from the debug launch configuration
	const devCliPath = process.env.KILOCODE_DEV_CLI_PATH
	if (devCliPath) {
		// Derive workspace root from the dev CLI path (cli/dist/index.js -> workspace root)
		const workspaceRoot = path.resolve(path.dirname(devCliPath), "..", "..")
		const devExtensionPath = path.join(workspaceRoot, "src", "dist", "extension.js")
		const devExtensionRoot = path.join(workspaceRoot, "src")

		if (existsSync(devExtensionPath)) {
			return {
				extensionBundlePath: devExtensionPath,
				extensionRootPath: devExtensionRoot,
			}
		}
	}

	// Production mode: extension is bundled in dist/kilocode/
	const extensionRootPath = path.join(distDir, "kilocode")
	const extensionBundlePath = path.join(extensionRootPath, "dist", "extension.js")

	return {
		extensionBundlePath,
		extensionRootPath,
	}
}
