import { execSync, spawn } from "node:child_process"
import * as path from "node:path"
import * as fs from "node:fs"
import { fileExistsAtPath } from "../../../utils/fs"

const CLI_PACKAGE_NAME = "@kilocode/cli"

export interface CliInstallResult {
	success: boolean
	cliPath?: string
	error?: string
	/** If true, suggests running in terminal instead */
	suggestTerminal?: boolean
}

/**
 * Get the npm install command for the CLI.
 * Useful for displaying to users or running in terminal.
 */
export function getCliInstallCommand(): string {
	return `npm install -g ${CLI_PACKAGE_NAME}`
}

/**
 * Check if Node.js is available in the system.
 * Returns the path to the node executable if found, null otherwise.
 */
export function findNodeExecutable(log?: (msg: string) => void): string | null {
	const cmd = process.platform === "win32" ? "where node" : "which node"
	try {
		const nodePath = execSync(cmd, { encoding: "utf-8" }).split(/\r?\n/)[0]?.trim()
		if (nodePath) {
			log?.(`Found Node.js at: ${nodePath}`)
			return nodePath
		}
	} catch {
		log?.("Node.js not found in PATH")
	}
	return null
}

/**
 * Check if npm is available in the system.
 * Returns the path to the npm executable if found, null otherwise.
 */
export function findNpmExecutable(log?: (msg: string) => void): string | null {
	const cmd = process.platform === "win32" ? "where npm" : "which npm"
	try {
		const npmPath = execSync(cmd, { encoding: "utf-8" }).split(/\r?\n/)[0]?.trim()
		if (npmPath) {
			log?.(`Found npm at: ${npmPath}`)
			return npmPath
		}
	} catch {
		log?.("npm not found in PATH")
	}
	return null
}

/**
 * Get the global npm bin directory where globally installed packages are linked.
 */
export function getNpmGlobalBinDir(log?: (msg: string) => void): string | null {
	try {
		const binDir = execSync("npm config get prefix", { encoding: "utf-8" }).trim()
		const fullBinPath = process.platform === "win32" ? binDir : path.join(binDir, "bin")
		log?.(`npm global bin directory: ${fullBinPath}`)
		return fullBinPath
	} catch (error) {
		log?.(`Failed to get npm global bin directory: ${error}`)
		return null
	}
}

/**
 * Install or update the Kilocode CLI globally using npm.
 * Returns a promise that resolves with the installation result.
 */
export function installOrUpdateCli(
	log?: (msg: string) => void,
	onProgress?: (message: string) => void,
): Promise<CliInstallResult> {
	return new Promise((resolve) => {
		const npmPath = findNpmExecutable(log)
		if (!npmPath) {
			resolve({
				success: false,
				error: "npm is not available. Please install Node.js to use the Agent Manager.",
			})
			return
		}

		log?.(`Running: npm install -g ${CLI_PACKAGE_NAME}`)

		const proc = spawn("npm", ["install", "-g", CLI_PACKAGE_NAME], {
			stdio: ["ignore", "pipe", "pipe"],
			shell: true,
			env: { ...process.env, NO_COLOR: "1" },
		})

		let stdout = ""
		let stderr = ""

		proc.stdout?.on("data", (data) => {
			const chunk = data.toString()
			stdout += chunk
			log?.(`npm stdout: ${chunk.trim()}`)
		})

		proc.stderr?.on("data", (data) => {
			const chunk = data.toString()
			stderr += chunk
			// npm often outputs progress to stderr
			log?.(`npm stderr: ${chunk.trim()}`)
		})

		proc.on("error", (error) => {
			log?.(`npm spawn error: ${error.message}`)
			resolve({
				success: false,
				error: `Failed to run npm: ${error.message}`,
			})
		})

		proc.on("exit", async (code) => {
			if (code === 0) {
				log?.("npm install completed successfully")
				onProgress?.("Done!")

				// Find the installed CLI path
				const cliPath = await findInstalledCliPath(log)
				if (cliPath) {
					resolve({ success: true, cliPath })
				} else {
					resolve({
						success: false,
						error: "CLI was installed but could not be located. Please try restarting VS Code.",
					})
				}
			} else {
				log?.(`npm install failed with code ${code}`)
				const errorMessage = stderr.trim() || stdout.trim() || `npm exited with code ${code}`
				const lowerError = errorMessage.toLowerCase()

				// Detect permission errors that would benefit from terminal execution
				const isPermissionError =
					lowerError.includes("eacces") ||
					lowerError.includes("permission denied") ||
					lowerError.includes("eperm") ||
					lowerError.includes("requires administrator") ||
					lowerError.includes("access is denied")

				resolve({
					success: false,
					error: `Failed to install CLI: ${errorMessage}`,
					suggestTerminal: isPermissionError,
				})
			}
		})
	})
}

/**
 * Find the path to the installed kilocode CLI executable.
 * Uses login shell to pick up version manager environments (nvm, fnm, volta, etc.)
 */
async function findInstalledCliPath(log?: (msg: string) => void): Promise<string | null> {
	// On non-Windows, try login shell first (picks up nvm, fnm, volta, etc.)
	if (process.platform !== "win32") {
		const loginShellResult = findViaLoginShell(log)
		if (loginShellResult) return loginShellResult
	}

	// Try direct PATH lookup
	const cmd = process.platform === "win32" ? "where kilocode" : "which kilocode"
	try {
		const pathResult = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).split(/\r?\n/)[0]?.trim()
		if (pathResult) {
			log?.(`Found kilocode CLI in PATH: ${pathResult}`)
			return pathResult
		}
	} catch {
		log?.("kilocode not in direct PATH after install")
	}

	// Try npm global bin directory
	const globalBin = getNpmGlobalBinDir(log)
	if (globalBin) {
		const candidates =
			process.platform === "win32"
				? [path.join(globalBin, "kilocode.cmd"), path.join(globalBin, "kilocode")]
				: [path.join(globalBin, "kilocode")]

		for (const candidate of candidates) {
			if (await fileExistsAtPath(candidate)) {
				log?.(`Found kilocode CLI at: ${candidate}`)
				return candidate
			}
		}
	}

	// Try common fallback paths
	const fallbackPaths = getNpmFallbackPaths(log)
	for (const candidate of fallbackPaths) {
		if (await fileExistsAtPath(candidate)) {
			log?.(`Found kilocode CLI at fallback: ${candidate}`)
			return candidate
		}
	}

	return null
}

/**
 * Try to find kilocode by running `which` in a login shell.
 * This sources the user's shell profile which sets up version managers.
 */
function findViaLoginShell(log?: (msg: string) => void): string | null {
	const userShell = process.env.SHELL || "/bin/bash"
	const shellName = path.basename(userShell)
	const shellFlags = shellName === "zsh" ? "-l -i" : "-l"
	const cmd = `${userShell} ${shellFlags} -c 'which kilocode' 2>/dev/null`

	try {
		log?.(`Trying login shell lookup: ${cmd}`)
		const result = execSync(cmd, {
			encoding: "utf-8",
			timeout: 10000,
			env: { ...process.env, HOME: process.env.HOME },
		})
			.split(/\r?\n/)[0]
			?.trim()

		if (result && !result.includes("not found")) {
			log?.(`Found CLI via login shell: ${result}`)
			return result
		}
	} catch (error) {
		log?.(`Login shell lookup failed: ${error}`)
	}

	return null
}

function getNpmFallbackPaths(log?: (msg: string) => void): string[] {
	const home = process.env.HOME || process.env.USERPROFILE || ""

	if (process.platform === "win32") {
		const appData = process.env.APPDATA || ""
		const localAppData = process.env.LOCALAPPDATA || ""
		return [
			appData ? path.join(appData, "npm", "kilocode.cmd") : "",
			appData ? path.join(appData, "npm", "kilocode") : "",
			localAppData ? path.join(localAppData, "npm", "kilocode.cmd") : "",
		].filter(Boolean)
	}

	// macOS and Linux paths
	const paths = [
		// macOS Homebrew (Apple Silicon)
		"/opt/homebrew/bin/kilocode",
		// macOS Homebrew (Intel) and Linux standard
		"/usr/local/bin/kilocode",
		// Common user-local npm prefix
		path.join(home, ".npm-global", "bin", "kilocode"),
		// nvm: scan installed versions
		...getNvmPaths(home, log),
		// fnm
		path.join(home, ".local", "share", "fnm", "aliases", "default", "bin", "kilocode"),
		// volta
		path.join(home, ".volta", "bin", "kilocode"),
		// asdf nodejs plugin
		path.join(home, ".asdf", "shims", "kilocode"),
		// Linux snap
		"/snap/bin/kilocode",
		// Linux user local bin
		path.join(home, ".local", "bin", "kilocode"),
	]

	return paths.filter(Boolean)
}

/**
 * Get potential nvm paths for the kilocode CLI.
 */
function getNvmPaths(home: string, log?: (msg: string) => void): string[] {
	const nvmDir = process.env.NVM_DIR || path.join(home, ".nvm")
	const versionsDir = path.join(nvmDir, "versions", "node")

	const paths: string[] = []

	if (process.env.NVM_BIN) {
		paths.push(path.join(process.env.NVM_BIN, "kilocode"))
	}

	try {
		if (fs.existsSync(versionsDir)) {
			const versions = fs.readdirSync(versionsDir)
			versions.sort().reverse()
			log?.(`Found ${versions.length} nvm node versions to check`)
			for (const version of versions) {
				paths.push(path.join(versionsDir, version, "bin", "kilocode"))
			}
		}
	} catch (error) {
		log?.(`Could not scan nvm versions directory: ${error}`)
	}

	return paths
}

/**
 * Check if Node.js and npm are available for CLI installation.
 */
export function canInstallCli(log?: (msg: string) => void): boolean {
	const hasNode = findNodeExecutable(log) !== null
	const hasNpm = findNpmExecutable(log) !== null
	return hasNode && hasNpm
}
