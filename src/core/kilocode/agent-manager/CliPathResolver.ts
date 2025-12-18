import * as path from "node:path"
import * as fs from "node:fs"
import { execSync } from "node:child_process"
import { fileExistsAtPath } from "../../../utils/fs"
import { getLocalCliPath } from "./CliInstaller"

/**
 * Find the kilocode CLI executable.
 *
 * Resolution order:
 * 1. VS Code setting `kiloCode.agentManager.cliPath`
 * 2. Workspace-local build at <workspace>/cli/dist/index.js
 * 3. Local installation at ~/.kilocode/cli/pkg (for immutable systems like NixOS)
 * 4. Login shell lookup (respects user's nvm, fnm, volta, asdf config)
 * 5. Direct PATH lookup (fallback for system-wide installs)
 * 6. Common npm installation paths (last resort)
 *
 * IMPORTANT: Login shell is checked BEFORE direct PATH because:
 * - The user's shell environment is the source of truth for which node/npm they use
 * - Direct PATH might find stale system-wide installations (e.g., old homebrew version)
 * - When we auto-update via `npm install -g`, it installs to the user's node (nvm etc.)
 * - So we need to find the CLI in the same location where updates go
 */
export async function findKilocodeCli(log?: (msg: string) => void): Promise<string | null> {
	// 1) Explicit override from settings
	try {
		// Lazy import avoids hard dep when running in non-extension contexts
		const vscode = await import("vscode")
		const config = vscode.workspace.getConfiguration("kiloCode")
		const overridePath = config.get<string>("agentManager.cliPath")
		if (overridePath) {
			log?.(`Using CLI path override from settings: ${overridePath}`)
			if (await fileExistsAtPath(overridePath)) {
				return overridePath
			}
			log?.(`WARNING: Override path does not exist: ${overridePath}`)
		}

		// 2) Workspace-local build (useful during development)
		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (workspacePath) {
			const localCli = path.join(workspacePath, "cli", "dist", "index.js")
			if (await fileExistsAtPath(localCli)) {
				log?.(`Using workspace CLI: ${localCli}`)
				return localCli
			}
		}
	} catch (error) {
		log?.(`findKilocodeCli: vscode lookup failed, falling back to PATH. Error: ${String(error)}`)
	}

	// 3) Check local installation (for immutable systems like NixOS)
	// This is checked early because it's a deliberate user choice for systems that can't use global install
	const localCliPath = getLocalCliPath()
	if (await fileExistsAtPath(localCliPath)) {
		log?.(`Found local CLI installation: ${localCliPath}`)
		return localCliPath
	}

	// 4) Try login shell FIRST to pick up user's shell environment (nvm, fnm, volta, asdf, etc.)
	// This is preferred because it respects the user's actual node environment.
	// When we run `npm install -g`, it installs to this environment, so we should find CLI here.
	const loginShellResult = findViaLoginShell(log)
	if (loginShellResult) return loginShellResult

	// 5) Fall back to direct PATH lookup (for users without version managers)
	const directPathResult = findInPath(log)
	if (directPathResult) return directPathResult

	// 6) Last resort: scan common npm installation paths
	log?.("Falling back to scanning common installation paths...")
	for (const candidate of getNpmPaths(log)) {
		try {
			if (await fileExistsAtPath(candidate)) {
				log?.(`Found CLI at: ${candidate}`)
				return candidate
			}
		} catch (error) {
			log?.(`Error checking path ${candidate}: ${error}`)
		}
	}

	log?.("kilocode CLI not found")
	return null
}

/**
 * Try to find kilocode in the current process PATH.
 * This works when CLI is installed in a system-wide location.
 */
function findInPath(log?: (msg: string) => void): string | null {
	const cmd = process.platform === "win32" ? "where kilocode" : "which kilocode"
	try {
		const result = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).split(/\r?\n/)[0]?.trim()
		if (result) {
			log?.(`Found CLI in PATH: ${result}`)
			return result
		}
	} catch {
		log?.("kilocode not found in direct PATH lookup")
	}
	return null
}

/**
 * Try to find kilocode by running `which` in a login shell.
 * This sources the user's shell profile (~/.zshrc, ~/.bashrc, etc.)
 * which sets up version managers like nvm, fnm, volta, asdf, etc.
 *
 * This is the most reliable way to find CLI installed via version managers
 * because VS Code's extension host doesn't inherit the user's shell environment.
 */
function findViaLoginShell(log?: (msg: string) => void): string | null {
	if (process.platform === "win32") {
		// Windows doesn't have the same shell environment concept
		return null
	}

	// Detect user's shell from SHELL env var, default to bash
	const userShell = process.env.SHELL || "/bin/bash"
	const shellName = path.basename(userShell)

	// Use login shell (-l) to source profile files, interactive (-i) for some shells
	// that only source certain files in interactive mode
	const shellFlags = shellName === "zsh" ? "-l -i" : "-l"
	const cmd = `${userShell} ${shellFlags} -c 'which kilocode' 2>/dev/null`

	try {
		log?.(`Trying login shell lookup: ${cmd}`)
		const result = execSync(cmd, {
			encoding: "utf-8",
			timeout: 10000, // 10s timeout - login shells can be slow
			env: { ...process.env, HOME: process.env.HOME }, // Ensure HOME is set
		})
			.split(/\r?\n/)[0]
			?.trim()

		if (result && !result.includes("not found")) {
			log?.(`Found CLI via login shell: ${result}`)
			return result
		}
	} catch (error) {
		// This is expected if CLI is not installed or shell init is slow/broken
		log?.(`Login shell lookup failed (this is normal if CLI not installed via version manager): ${error}`)
	}

	return null
}

/**
 * Get fallback paths to check for CLI installation.
 * This is used when login shell lookup fails or on Windows.
 */
function getNpmPaths(log?: (msg: string) => void): string[] {
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
		// Local installation (for immutable systems like NixOS)
		getLocalCliPath(),
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
 * nvm installs node versions in ~/.nvm/versions/node/
 *
 * Note: This is a fallback - the login shell approach (findViaLoginShell)
 * is preferred because it respects the user's shell configuration.
 */
function getNvmPaths(home: string, log?: (msg: string) => void): string[] {
	const nvmDir = process.env.NVM_DIR || path.join(home, ".nvm")
	const versionsDir = path.join(nvmDir, "versions", "node")

	const paths: string[] = []

	// Check NVM_BIN if set (current nvm version in the shell)
	if (process.env.NVM_BIN) {
		paths.push(path.join(process.env.NVM_BIN, "kilocode"))
	}

	// Scan the nvm versions directory for installed node versions
	try {
		if (fs.existsSync(versionsDir)) {
			const versions = fs.readdirSync(versionsDir)
			// Sort versions in reverse order to check newer versions first
			versions.sort().reverse()
			log?.(`Found ${versions.length} nvm node versions to check`)
			for (const version of versions) {
				paths.push(path.join(versionsDir, version, "bin", "kilocode"))
			}
		}
	} catch (error) {
		// This is normal if user doesn't have nvm installed
		log?.(`Could not scan nvm versions directory: ${error}`)
	}

	return paths
}
