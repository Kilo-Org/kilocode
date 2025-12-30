import * as path from "node:path"
import * as fs from "node:fs"
import { execSync, spawnSync } from "node:child_process"
import { fileExistsAtPath } from "../../../utils/fs"
import { getLocalCliPath } from "./CliInstaller"
import { stripShellControlCodes } from "./ShellOutput"

/**
 * Result of CLI discovery including optional shell environment.
 * The shellPath is captured from login shell lookup on macOS/Linux to ensure
 * the spawned CLI process has access to the same tools (like git) that were
 * available when finding the CLI.
 */
export interface CliDiscoveryResult {
	cliPath: string
	/** PATH from login shell - use this when spawning CLI on macOS to ensure tools like git are available */
	shellPath?: string
}

/**
 * Case-insensitive lookup for environment variables.
 * Windows environment variables can have inconsistent casing (PATH, Path, path).
 */
function getCaseInsensitive(target: NodeJS.ProcessEnv, key: string): string | undefined {
	const lowercaseKey = key.toLowerCase()
	const equivalentKey = Object.keys(target).find((k) => k.toLowerCase() === lowercaseKey)
	return equivalentKey ? target[equivalentKey] : target[key]
}

function extractAbsolutePath(line: string): string | null {
	const trimmed = line.trim()
	if (!trimmed) {
		return null
	}
	if (path.isAbsolute(trimmed)) {
		return trimmed
	}
	const parts = trimmed.split(/\s+/)
	const last = parts[parts.length - 1]
	return path.isAbsolute(last) ? last : null
}

function isExecutablePath(candidate: string): boolean {
	try {
		const stat = fs.statSync(candidate)
		return stat.isFile()
	} catch {
		return false
	}
}

/**
 * Check if a path exists and is a file (not a directory).
 * Follows symlinks - a symlink to a file returns true, symlink to a directory returns false.
 */
async function pathExistsAsFile(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.promises.stat(filePath)
		return stat.isFile()
	} catch (e: unknown) {
		if (e instanceof Error && "code" in e && e.code === "EACCES") {
			try {
				const lstat = await fs.promises.lstat(filePath)
				return lstat.isFile() || lstat.isSymbolicLink()
			} catch {
				return false
			}
		}
		return false
	}
}

/**
 * Find an executable by name, resolving it against PATH and PATHEXT (on Windows).
 */
export async function findExecutable(
	command: string,
	cwd?: string,
	paths?: string[],
	env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
	if (path.isAbsolute(command)) {
		return (await pathExistsAsFile(command)) ? command : undefined
	}

	if (cwd === undefined) {
		cwd = process.cwd()
	}

	const dir = path.dirname(command)
	if (dir !== ".") {
		const fullPath = path.join(cwd, command)
		return (await pathExistsAsFile(fullPath)) ? fullPath : undefined
	}

	const envPath = getCaseInsensitive(env, "PATH")
	if (paths === undefined && typeof envPath === "string") {
		paths = envPath.split(path.delimiter)
	}

	if (paths === undefined || paths.length === 0) {
		const fullPath = path.join(cwd, command)
		return (await pathExistsAsFile(fullPath)) ? fullPath : undefined
	}

	for (const pathEntry of paths) {
		let fullPath: string
		if (path.isAbsolute(pathEntry)) {
			fullPath = path.join(pathEntry, command)
		} else {
			fullPath = path.join(cwd, pathEntry, command)
		}

		if (process.platform === "win32") {
			const pathExt = getCaseInsensitive(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD"
			for (const ext of pathExt.split(";")) {
				const withExtension = fullPath + ext
				if (await pathExistsAsFile(withExtension)) {
					return withExtension
				}
			}
		}

		if (await pathExistsAsFile(fullPath)) {
			return fullPath
		}
	}

	const fullPath = path.join(cwd, command)
	return (await pathExistsAsFile(fullPath)) ? fullPath : undefined
}

/**
 * Find the kilocode CLI executable.
 *
 * Resolution order:
 * 1. VS Code setting `kiloCode.agentManager.cliPath`
 * 2. Workspace-local build at <workspace>/cli/dist/index.js
 * 3. Local installation at ~/.kilocode/cli/pkg (for immutable systems like NixOS)
 * 4. Login shell lookup (respects user's nvm, fnm, volta, asdf config)
 * 5. Direct PATH lookup using findExecutable (handles PATHEXT on Windows)
 * 6. Common npm installation paths (last resort)
 *
 * IMPORTANT: Login shell is checked BEFORE direct PATH because:
 * - The user's shell environment is the source of truth for which node/npm they use
 * - Direct PATH might find stale system-wide installations (e.g., old homebrew version)
 * - When we auto-update via `npm install -g`, it installs to the user's node (nvm etc.)
 * - So we need to find the CLI in the same location where updates go
 *
 * @returns CliDiscoveryResult with cliPath and optional shellPath for spawning
 */
export async function findKilocodeCli(log?: (msg: string) => void): Promise<CliDiscoveryResult | null> {
	// Capture shell PATH early for use when spawning (macOS/Linux only)
	// This ensures the CLI has access to the same tools (git, etc.) that were available
	// when finding it, even when the editor is launched from Finder/Spotlight
	const shellEnv = process.platform !== "win32" ? getLoginShellPath(log) : undefined

	// 1) Explicit override from settings
	try {
		// Lazy import avoids hard dep when running in non-extension contexts
		const vscode = await import("vscode")
		const config = vscode.workspace.getConfiguration("kiloCode")
		const overridePath = config.get<string>("agentManager.cliPath")
		if (overridePath) {
			log?.(`Using CLI path override from settings: ${overridePath}`)
			if (await fileExistsAtPath(overridePath)) {
				return { cliPath: overridePath, shellPath: shellEnv }
			}
			log?.(`WARNING: Override path does not exist: ${overridePath}`)
		}

		// 2) Workspace-local build (useful during development)
		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (workspacePath) {
			const localCli = path.join(workspacePath, "cli", "dist", "index.js")
			if (await fileExistsAtPath(localCli)) {
				log?.(`Using workspace CLI: ${localCli}`)
				return { cliPath: localCli, shellPath: shellEnv }
			}
		}
	} catch (error) {
		log?.(`findKilocodeCli: vscode lookup failed, falling back to PATH. Error: ${String(error)}`)
	}

	// 3) Check local installation (for immutable systems like NixOS)
	const localCliPath = getLocalCliPath()
	if (await fileExistsAtPath(localCliPath)) {
		log?.(`Found local CLI installation: ${localCliPath}`)
		return { cliPath: localCliPath, shellPath: shellEnv }
	}

	// 4) Try login shell FIRST to pick up user's shell environment (nvm, fnm, volta, asdf, etc.)
	const loginShellResult = findViaLoginShell(log)
	if (loginShellResult) return { cliPath: loginShellResult, shellPath: shellEnv }

	// 5) Use findExecutable to resolve CLI path (handles PATHEXT on Windows)
	const executablePath = await findExecutable("kilocode")
	if (executablePath) {
		log?.(`Found CLI via PATH: ${executablePath}`)
		return { cliPath: executablePath, shellPath: shellEnv }
	}
	log?.("kilocode not found in PATH lookup")

	// 6) Last resort: scan common npm installation paths
	log?.("Falling back to scanning common installation paths...")
	for (const candidate of getNpmPaths(log)) {
		try {
			if (await fileExistsAtPath(candidate)) {
				log?.(`Found CLI at: ${candidate}`)
				return { cliPath: candidate, shellPath: shellEnv }
			}
		} catch (error) {
			log?.(`Error checking path ${candidate}: ${error}`)
		}
	}

	log?.("kilocode CLI not found")
	return null
}

/**
 * Get the PATH from the user's login shell.
 * This is essential on macOS when the editor is launched from Finder/Spotlight,
 * as the extension host doesn't inherit the user's shell environment.
 * The captured PATH ensures spawned CLI processes can access tools like git.
 *
 * Uses markers to reliably extract PATH even if shell startup scripts print
 * banners, warnings, or other output that would otherwise pollute the result.
 */
function getLoginShellPath(log?: (msg: string) => void): string | undefined {
	if (process.platform === "win32") {
		return undefined
	}

	const userShell = process.env.SHELL || "/bin/bash"
	const shellName = path.basename(userShell)

	// Use -i -l (interactive + login) to source both .zprofile/.bash_profile AND .zshrc/.bashrc
	// stdio: ['ignore', 'pipe', 'pipe'] prevents stdin from blocking
	const shellArgs = shellName === "tcsh" || shellName === "csh" ? ["-ic"] : ["-i", "-l", "-c"]

	// Use markers to reliably extract PATH even if shell prints banners/warnings
	const startMarker = "__KILO_PATH_START__"
	const endMarker = "__KILO_PATH_END__"
	const command = `printf '${startMarker}%s${endMarker}\\n' "$PATH"`

	try {
		const result = spawnSync(userShell, [...shellArgs, command], {
			encoding: "utf-8",
			timeout: 10000,
			env: { ...process.env, HOME: process.env.HOME },
			stdio: ["ignore", "pipe", "pipe"], // stdin ignored, stdout/stderr captured
		})

		if (result.error) {
			log?.(`Could not capture shell PATH: ${result.error}`)
			return undefined
		}

		const output = result.stdout ?? ""

		// Extract PATH from between markers
		const startIdx = output.indexOf(startMarker)
		const endIdx = output.indexOf(endMarker)

		if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
			log?.(`Could not find PATH markers in shell output`)
			return undefined
		}

		const shellPath = output.slice(startIdx + startMarker.length, endIdx)

		if (shellPath && shellPath !== process.env.PATH) {
			log?.(`Captured shell PATH (${shellPath.split(":").length} entries)`)
			return shellPath
		}
	} catch (error) {
		log?.(`Could not capture shell PATH: ${error}`)
	}

	return undefined
}

/**
 * Try to find kilocode by running `which` in a login shell.
 * This sources the user's shell profile (~/.zshrc, ~/.bashrc, etc.)
 * which sets up version managers like nvm, fnm, volta, asdf, etc.
 */
function findViaLoginShell(log?: (msg: string) => void): string | null {
	if (process.platform === "win32") {
		return null
	}

	const userShell = process.env.SHELL || "/bin/bash"
	const shellName = path.basename(userShell)

	const shellFlags = shellName === "zsh" ? "-l -i" : "-l"
	const cmd = `${userShell} ${shellFlags} -c 'which kilocode' 2>/dev/null`

	try {
		log?.(`Trying login shell lookup: ${cmd}`)
		const rawOutput = execSync(cmd, {
			encoding: "utf-8",
			timeout: 10000,
			env: { ...process.env, HOME: process.env.HOME },
		})
		const lines = stripShellControlCodes(rawOutput)
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)

		for (const line of lines) {
			if (line.includes("not found")) {
				continue
			}
			const candidate = extractAbsolutePath(line)
			if (candidate && isExecutablePath(candidate)) {
				log?.(`Found CLI via login shell: ${candidate}`)
				return candidate
			}
		}
	} catch (error) {
		log?.(`Login shell lookup failed (this is normal if CLI not installed via version manager): ${error}`)
	}

	return null
}

/**
 * Get fallback paths to check for CLI installation.
 */
function getNpmPaths(log?: (msg: string) => void): string[] {
	const home = process.env.HOME || process.env.USERPROFILE || ""

	if (process.platform === "win32") {
		const appData = process.env.APPDATA || ""
		const localAppData = process.env.LOCALAPPDATA || ""
		const basePaths = [appData, localAppData].filter(Boolean).map((base) => path.join(base, "npm", "kilocode"))
		const pathExt = getCaseInsensitive(process.env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD"
		const extensions = pathExt.split(";").filter(Boolean)
		return basePaths.flatMap((basePath) => extensions.map((ext) => `${basePath}${ext}`))
	}

	const paths = [
		getLocalCliPath(),
		"/opt/homebrew/bin/kilocode",
		"/usr/local/bin/kilocode",
		path.join(home, ".npm-global", "bin", "kilocode"),
		...getNvmPaths(home, log),
		path.join(home, ".local", "share", "fnm", "aliases", "default", "bin", "kilocode"),
		path.join(home, ".volta", "bin", "kilocode"),
		path.join(home, ".asdf", "shims", "kilocode"),
		"/snap/bin/kilocode",
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
