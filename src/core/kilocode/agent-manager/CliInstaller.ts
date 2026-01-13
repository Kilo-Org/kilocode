import { execSync } from "node:child_process"
import * as path from "node:path"
import * as os from "node:os"

const CLI_PACKAGE_NAME = "@kilocode/cli"
const LOCAL_CLI_DIR = path.join(os.homedir(), ".kilocode", "cli", "pkg")

/**
 * Get the path to the local CLI installation directory.
 * This is where the CLI will be installed for immutable systems like NixOS.
 */
export function getLocalCliDir(): string {
	return LOCAL_CLI_DIR
}

/**
 * Get the path to the local CLI bin directory.
 * This is the directory that should be added to PATH.
 */
export function getLocalCliBinDir(): string {
	return path.join(LOCAL_CLI_DIR, "node_modules", ".bin")
}

/**
 * Get the path to the locally installed CLI executable.
 * Returns the full path to the kilocode binary in the local installation.
 */
export function getLocalCliPath(): string {
	const binDir = getLocalCliBinDir()
	// Windows uses .cmd wrapper scripts
	const executable = process.platform === "win32" ? "kilocode.cmd" : "kilocode"
	return path.join(binDir, executable)
}

/**
 * Get the npm install command for the CLI (global installation).
 * Useful for displaying to users or running in terminal.
 */
export function getCliInstallCommand(): string {
	return `npm install -g ${CLI_PACKAGE_NAME}`
}

/**
 * Get the npm install command for local CLI installation.
 * This installs the CLI to ~/.kilocode/cli/pkg for systems that don't support global installation.
 */
export function getLocalCliInstallCommand(): string {
	return `npm install ${CLI_PACKAGE_NAME} --prefix ${LOCAL_CLI_DIR}`
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
 * Check if Node.js and npm are available for CLI installation.
 */
export function canInstallCli(log?: (msg: string) => void): boolean {
	const hasNode = findNodeExecutable(log) !== null
	const hasNpm = findNpmExecutable(log) !== null
	return hasNode && hasNpm
}
