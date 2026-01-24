/**
 * CLI Path Resolver
 *
 * Provides utilities for finding CLI executables across different platforms
 * and installation methods (npm global, nvm, fnm, volta, asdf, local installation).
 */

import * as path from "node:path"
import * as fs from "node:fs"
import { execSync, spawnSync } from "node:child_process"

/**
 * Case-insensitive lookup for environment variables.
 * Windows environment variables can have inconsistent casing (PATH, Path, path).
 */
function getCaseInsensitive(target: NodeJS.ProcessEnv, key: string): string | null {
	const lowercaseKey = key.toLowerCase()
	const equivalentKey = Object.keys(target).find((k) => k.toLowerCase() === lowercaseKey)
	if (equivalentKey) {
		const value = target[equivalentKey]
		return value ?? null
	}
	const value = target[key]
	return value ?? null
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
	if (parts.length === 0) {
		return null
	}
	const last = parts[parts.length - 1]
	if (!last) {
		return null
	}
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
 * Get the PATH from the user's login shell.
 * This is essential on macOS when the editor is launched from Finder/Spotlight,
 * as the extension host doesn't inherit the user's shell environment.
 * The captured PATH ensures spawned CLI processes can access tools like git.
 *
 * Uses markers to reliably extract PATH even if shell startup scripts print
 * banners, warnings, or other output that would otherwise pollute the result.
 */
export function getLoginShellPath(log?: (msg: string) => void): string | undefined {
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
export function findViaLoginShell(log?: (msg: string) => void): string | null {
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
		const lines = rawOutput
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
export function getNpmPaths(log?: (msg: string) => void): string[] {
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
export function getNvmPaths(home: string, log?: (msg: string) => void): string[] {
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
