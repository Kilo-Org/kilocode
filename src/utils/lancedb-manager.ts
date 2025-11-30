// kilocode_change - new file

import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { promisify } from "util"
import { exec } from "child_process"
import { safeWriteJson } from "./safeWriteJson"

const execAsync = promisify(exec)

export interface PlatformInfo {
	platform: string
	arch: string
	packageName: string
	nodeFileName: string
}

export class LanceDBManager {
	private readonly dependenciesPath: string
	private readonly lancedbVersion = "0.21.2"

	constructor(dependenciesPath: string) {
		this.dependenciesPath = dependenciesPath
	}

	/**
	 * get current platform information
	 */
	private getCurrentPlatform(): PlatformInfo {
		const platform = os.platform()
		const arch = os.arch()

		let packageName: string
		let nodeFileName: string

		let isMusl = false
		switch (platform) {
			case "win32":
				if (arch === "x64") {
					packageName = "@lancedb/lancedb-win32-x64-msvc"
					nodeFileName = "lancedb.win32-x64-msvc.node"
				} else if (arch === "arm64") {
					packageName = "@lancedb/lancedb-win32-arm64-msvc"
					nodeFileName = "lancedb.win32-arm64-msvc.node"
				} else {
					throw new Error(`Unsupported Windows architecture: ${arch}`)
				}
				break
			case "darwin":
				if (arch === "x64") {
					packageName = "@lancedb/lancedb-darwin-x64"
					nodeFileName = "lancedb.darwin-x64.node"
				} else if (arch === "arm64") {
					packageName = "@lancedb/lancedb-darwin-arm64"
					nodeFileName = "lancedb.darwin-arm64.node"
				} else {
					throw new Error(`Unsupported macOS architecture: ${arch}`)
				}
				break
			case "linux":
				isMusl = process.versions?.musl !== undefined
				if (arch === "x64") {
					if (isMusl) {
						packageName = "@lancedb/lancedb-linux-x64-musl"
						nodeFileName = "lancedb.linux-x64-musl.node"
					} else {
						packageName = "@lancedb/lancedb-linux-x64-gnu"
						nodeFileName = "lancedb.linux-x64-gnu.node"
					}
				} else if (arch === "arm64") {
					if (isMusl) {
						packageName = "@lancedb/lancedb-linux-arm64-musl"
						nodeFileName = "lancedb.linux-arm64-musl.node"
					} else {
						packageName = "@lancedb/lancedb-linux-arm64-gnu"
						nodeFileName = "lancedb.linux-arm64-gnu.node"
					}
				} else {
					throw new Error(`Unsupported Linux architecture: ${arch}`)
				}
				break
			default:
				throw new Error(`Unsupported platform: ${platform}, arch: ${arch}`)
		}

		return { platform, arch, packageName, nodeFileName }
	}

	/**
	 * get lancedb dependencies path
	 */
	private getDependenciesPath(): string {
		return path.join(this.dependenciesPath, "lancedb-deps")
	}

	/**
	 * checking LanceDB binaries
	 */
	async checkLanceDBBinaries(): Promise<boolean> {
		try {
			const platformInfo = this.getCurrentPlatform()
			const depsPath = this.getDependenciesPath()

			const lancedbPath = path.join(depsPath, "node_modules", "@lancedb", "lancedb")
			const packageJsonPath = path.join(lancedbPath, "package.json")
			const distPath = path.join(lancedbPath, "dist")

			const platformBinaryPath = path.join(
				depsPath,
				"node_modules",
				"@lancedb",
				platformInfo.packageName.split("/")[1],
			)
			const nodeFilePath = path.join(platformBinaryPath, platformInfo.nodeFileName)

			if (fs.existsSync(packageJsonPath) && fs.existsSync(distPath) && fs.existsSync(nodeFilePath)) {
				try {
					const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
					if (pkg.version === this.lancedbVersion) {
						return true
					}
				} catch (e) {
					console.error("Error reading LanceDB package.json:", e)
				}
			}
			return false
		} catch (error) {
			console.error("Error checking LanceDB binaries:", error)
			return false
		}
	}

	/**
	 * Install LanceDB dependencies using npm only.
	 * This method generates a package.json and runs npm install for @lancedb/lancedb.
	 */
	async installLanceDBDependencies(
		progress?: vscode.Progress<{ message?: string; increment?: number }>,
	): Promise<void> {
		try {
			const depsPath = this.getDependenciesPath()

			// Ensure the dependencies directory exists
			if (!fs.existsSync(depsPath)) {
				fs.mkdirSync(depsPath, { recursive: true })
			}

			// Generate package.json if it does not exist
			const packageJsonPath = path.join(depsPath, "package.json")
			safeWriteJson(packageJsonPath, {
				name: "lancedb-deps",
				version: "1.0.0",
				description: "LanceDB dependencies for VSCode extension",
				private: true,
				dependencies: {},
			})

			progress?.report({ message: "Installing LanceDB dependencies...", increment: 50 })
			await execAsync(`npm install @lancedb/lancedb@${this.lancedbVersion}`, { cwd: depsPath })

			progress?.report({ message: "Installation completed!", increment: 50 })

			console.log("LanceDB dependencies installed successfully")
		} catch (error) {
			console.error("Failed to install LanceDB dependencies:", error)
			throw new Error(`Failed to install LanceDB dependencies: ${error.message}`)
		}
	}

	/**
	 * ensure LanceDB dependencies are available
	 */
	async ensureLanceDBAvailable(): Promise<void> {
		const isAvailable = await this.checkLanceDBBinaries()

		if (!isAvailable) {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Installing LanceDB dependencies",
					cancellable: false,
				},
				async (progress) => {
					await this.installLanceDBDependencies(progress)
				},
			)
		}
	}

	/**
	 * get dependencies path for setting NODE_PATH
	 */
	getNodeModulesPath(): string {
		return path.join(this.getDependenciesPath(), "node_modules")
	}

	/**
	 * clean up downloaded dependencies
	 */
	async cleanupDependencies(): Promise<void> {
		const depsPath = this.getDependenciesPath()
		if (fs.existsSync(depsPath)) {
			fs.rmSync(depsPath, { recursive: true, force: true })
		}
	}
}
