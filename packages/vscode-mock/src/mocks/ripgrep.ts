/**
 * Mock implementation of ripgrep functionality for CLI environment
 * This serves as an entry point but delegates to the real @vscode/ripgrep package
 */

const path = require("path")
const fs = require("fs")

/**
 * Find the actual ripgrep binary from @vscode/ripgrep package
 */
export async function getBinPath(vscodeAppRoot?: string): Promise<string> {
	// Use the workspace root from VS Code mock environment
	const workspaceRoot = vscodeAppRoot || process.env.WORKSPACE_ROOT || process.cwd()

	// Try the known pnpm location first
	const pnpmRipgrepPath = path.join(
		workspaceRoot,
		"node_modules",
		".pnpm",
		"@vscode+ripgrep@1.15.14",
		"node_modules",
		"@vscode",
		"ripgrep",
	)

	const isWindows = process.platform.startsWith("win")
	const binName = isWindows ? "rg.exe" : "rg"

	// Check pnpm location first
	const pnpmBinPath = path.join(pnpmRipgrepPath, "bin", binName)
	if (fs.existsSync(pnpmBinPath)) {
		console.log(`[DEBUG] Found ripgrep binary at: ${pnpmBinPath}`)
		return pnpmBinPath
	}

	// Fallback: search from workspace root
	let searchDir = workspaceRoot
	while (searchDir !== path.dirname(searchDir)) {
		const ripgrepPath = path.join(searchDir, "node_modules", "@vscode", "ripgrep")
		if (fs.existsSync(ripgrepPath)) {
			const binPath = path.join(ripgrepPath, "bin", binName)
			if (fs.existsSync(binPath)) {
				console.log(`[DEBUG] Found ripgrep binary at: ${binPath}`)
				return binPath
			}
		}
		searchDir = path.dirname(searchDir)
	}

	throw new Error(
		"Could not find @vscode/ripgrep binary. Make sure it's installed and the postinstall script has run.",
	)
}

/**
 * Use the real ripgrep implementation from the original src/services/ripgrep
 * This imports and delegates to the actual implementation
 */
export async function regexSearchFiles(
	cwd: string,
	directoryPath: string,
	regex: string,
	filePattern?: string,
): Promise<string> {
	try {
		// Try to use the real implementation
		const { regexSearchFiles: realRegexSearchFiles } = require("../../../src/services/ripgrep")
		return await realRegexSearchFiles(cwd, directoryPath, regex, filePattern)
	} catch (error) {
		console.warn("[RIPGREP MOCK] Failed to use real implementation, falling back to simple search:", error)

		// Fallback to simple file listing
		try {
			const files = fs.readdirSync(directoryPath)
			const results = files
				.filter((file: string) => {
					if (filePattern && filePattern !== "*") {
						// Simple glob matching
						const pattern = filePattern.replace(/\*/g, ".*")
						return new RegExp(pattern).test(file)
					}
					return true
				})
				.slice(0, 10) // Limit results
				.map((file: string) => `# ${file}\n----\n`)
				.join("\n")

			return results || "No results found"
		} catch (fallbackError) {
			return "No results found"
		}
	}
}
