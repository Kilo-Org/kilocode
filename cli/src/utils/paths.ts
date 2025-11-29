import * as crypto from "crypto"
import * as path from "path"
import * as fs from "fs"

/**
 * Centralized path management for Kilo Code CLI
 * All configuration and logs are stored in ~/.kilocode/
 */
export class KiloCodePaths {
	private static readonly BASE_DIR_NAME = ".kilocode"
	private static readonly CLI_SUBDIR = "cli"
	private static readonly WORKSPACE_MAP_FILE = "workspace-map.json"

	/**
	 * Get user home directory
	 */
	static getHomeDir(): string {
		return process.env.HOME || process.env.USERPROFILE || "/tmp"
	}

	/**
	 * Get base .kilocode/cli directory in user home
	 */
	static getKiloCodeDir(): string {
		return path.join(this.getHomeDir(), this.BASE_DIR_NAME, this.CLI_SUBDIR)
	}

	/**
	 * Get unified logs directory (shared across all workspaces)
	 */
	static getLogsDir(): string {
		return path.join(this.getKiloCodeDir(), "logs")
	}

	/**
	 * Get global storage directory (shared across all workspaces)
	 */
	static getGlobalStorageDir(): string {
		return path.join(this.getKiloCodeDir(), "global")
	}

	/**
	 * Get tasks base directory
	 */
	static getTasksDir(): string {
		return path.join(this.getGlobalStorageDir(), "tasks")
	}

	/**
	 * Get the path to the last session file for a workspace
	 */
	static getSessionFilePath(workspacePath: string): string {
		const workspaceDir = this.getWorkspaceStorageDir(workspacePath)

		return path.join(workspaceDir, "session.json")
	}

	/**
	 * Get workspaces base directory
	 */
	static getWorkspacesDir(): string {
		return path.join(this.getKiloCodeDir(), "workspaces")
	}

	/**
	 * Generate a deterministic 8-character hash for a workspace path
	 */
	static getWorkspaceHash(workspacePath: string): string {
		const absolutePath = path.resolve(workspacePath)
		const hash = crypto.createHash("sha256").update(absolutePath).digest("hex")
		return hash.substring(0, 8)
	}

	/**
	 * Sanitize workspace name for filesystem use
	 * - Convert to lowercase
	 * - Replace spaces and special chars with hyphens
	 * - Remove consecutive hyphens
	 * - Limit to 32 characters
	 */
	static sanitizeWorkspaceName(workspacePath: string): string {
		const basename = path.basename(workspacePath)

		// Convert to lowercase and replace non-alphanumeric chars with hyphens
		let sanitized = basename
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
			.replace(/-+/g, "-") // Replace consecutive hyphens with single hyphen

		// Limit length
		if (sanitized.length > 32) {
			sanitized = sanitized.substring(0, 32)
		}

		// Ensure it's not empty
		if (!sanitized) {
			sanitized = "workspace"
		}

		return sanitized
	}

	/**
	 * Get workspace folder name in format: {sanitized-name}-{hash}
	 */
	static getWorkspaceFolderName(workspacePath: string): string {
		const sanitizedName = this.sanitizeWorkspaceName(workspacePath)
		const hash = this.getWorkspaceHash(workspacePath)
		return `${sanitizedName}-${hash}`
	}

	/**
	 * Get workspace storage directory for a specific workspace
	 */
	static getWorkspaceStorageDir(workspacePath: string): string {
		const folderName = this.getWorkspaceFolderName(workspacePath)
		return path.join(this.getWorkspacesDir(), folderName)
	}

	/**
	 * Ensure a directory exists, creating it if necessary
	 */
	static ensureDirectoryExists(dirPath: string): void {
		try {
			if (!fs.existsSync(dirPath)) {
				fs.mkdirSync(dirPath, { recursive: true })
			}
		} catch {
			// Silent fail - let the calling code handle errors
		}
	}

	/**
	 * Get the workspace map file path
	 */
	private static getWorkspaceMapPath(): string {
		return path.join(this.getWorkspacesDir(), this.WORKSPACE_MAP_FILE)
	}

	/**
	 * Load workspace map (maps absolute paths to folder names)
	 */
	static getWorkspaceMap(): Record<string, string> {
		try {
			const mapPath = this.getWorkspaceMapPath()
			if (fs.existsSync(mapPath)) {
				const content = fs.readFileSync(mapPath, "utf-8")
				return JSON.parse(content)
			}
		} catch {
			// Return empty map on error
		}
		return {}
	}

	/**
	 * Update workspace map with a new workspace entry
	 */
	static updateWorkspaceMap(workspacePath: string, folderName: string): void {
		try {
			const absolutePath = path.resolve(workspacePath)
			const map = this.getWorkspaceMap()
			map[absolutePath] = folderName

			// Ensure workspaces directory exists
			this.ensureDirectoryExists(this.getWorkspacesDir())

			// Save updated map
			const mapPath = this.getWorkspaceMapPath()
			fs.writeFileSync(mapPath, JSON.stringify(map, null, 2))
		} catch {
			// Silent fail - map is optional
		}
	}

	/**
	 * Initialize all required directories for a workspace
	 */
	static initializeWorkspace(workspacePath: string): void {
		// Ensure base directories exist
		this.ensureDirectoryExists(this.getKiloCodeDir())
		this.ensureDirectoryExists(this.getLogsDir())
		this.ensureDirectoryExists(this.getGlobalStorageDir())
		this.ensureDirectoryExists(this.getWorkspacesDir())

		// Ensure workspace-specific directory exists
		const workspaceDir = this.getWorkspaceStorageDir(workspacePath)
		this.ensureDirectoryExists(workspaceDir)

		// Update workspace map
		const folderName = this.getWorkspaceFolderName(workspacePath)
		this.updateWorkspaceMap(workspacePath, folderName)
	}
}
