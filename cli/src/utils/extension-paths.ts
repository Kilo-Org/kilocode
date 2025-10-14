import * as path from "path"
import { fileURLToPath } from "url"

export interface ExtensionPaths {
	extensionBundlePath: string // Path to extension.js
	extensionRootPath: string // Path to extension root
}

/**
 * Resolves extension paths for production CLI.
 * Assumes the extension is bundled in dist/kilocode/
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

	// Navigate to dist directory
	const distDir = isInUtilsSubdir ? path.resolve(currentDir, "..") : currentDir

	// Extension is in dist/kilocode/
	const extensionRootPath = path.join(distDir, "kilocode")
	const extensionBundlePath = path.join(extensionRootPath, "dist", "extension.js")

	return {
		extensionBundlePath,
		extensionRootPath,
	}
}
