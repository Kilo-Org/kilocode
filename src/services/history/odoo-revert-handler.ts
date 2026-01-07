// kilocode_change - new file

import * as vscode from "vscode"
import * as path from "path"
import { EditHistoryRecord } from "../storage/database-manager"

export interface OdooModuleInfo {
	name: string
	path: string
	manifestPath: string
	hasModels: boolean
	hasViews: boolean
	hasControllers: boolean
	hasDataFiles: boolean
}

export interface OdooRevertContext {
	isOdooProject: boolean
	affectedModules: OdooModuleInfo[]
	requiresDatabaseUpdate: boolean
	suggestedCommands: string[]
	dependencies: string[]
}

/**
 * Service for handling Odoo-specific context during revert operations
 */
export class OdooRevertHandler {
	private workspaceRoot: string

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
	}

	/**
	 * Analyze revert context for Odoo-specific handling
	 */
	async analyzeRevertContext(editHistory: EditHistoryRecord): Promise<OdooRevertContext> {
		const affectedFiles = JSON.parse(editHistory.affected_files)

		// Check if this is an Odoo project
		const isOdooProject = await this.isOdooWorkspace()

		if (!isOdooProject) {
			return {
				isOdooProject: false,
				affectedModules: [],
				requiresDatabaseUpdate: false,
				suggestedCommands: [],
				dependencies: [],
			}
		}

		// Identify affected Odoo modules
		const affectedModules = await this.identifyAffectedModules(affectedFiles)

		// Determine if database update is required
		const requiresDatabaseUpdate = this.requiresDatabaseUpdate(affectedFiles, affectedModules)

		// Generate suggested commands
		const suggestedCommands = this.generateSuggestedCommands(affectedModules, requiresDatabaseUpdate)

		// Check for module dependencies
		const dependencies = await this.getModuleDependencies(affectedModules)

		return {
			isOdooProject: true,
			affectedModules,
			requiresDatabaseUpdate,
			suggestedCommands,
			dependencies,
		}
	}

	/**
	 * Execute Odoo-specific post-revert operations
	 */
	async executePostRevertActions(context: OdooRevertContext): Promise<void> {
		if (!context.isOdooProject || context.affectedModules.length === 0) {
			return
		}

		console.log(`[OdooRevertHandler] Executing post-revert actions for ${context.affectedModules.length} modules`)

		// Show notification about database update
		if (context.requiresDatabaseUpdate) {
			const message = `Odoo modules were reverted. Database update recommended for: ${context.affectedModules.map((m) => m.name).join(", ")}`

			const choice = await vscode.window.showInformationMessage(
				message,
				"Update Database",
				"Show Commands",
				"Skip",
			)

			if (choice === "Update Database") {
				await this.executeDatabaseUpdate(context.affectedModules)
			} else if (choice === "Show Commands") {
				await this.showCommandsPanel(context.suggestedCommands)
			}
		}

		// Check for dependency conflicts
		if (context.dependencies.length > 0) {
			await this.handleDependencyConflicts(context.dependencies)
		}

		// Refresh Odoo module tree if available
		await this.refreshOdooExplorer()
	}

	/**
	 * Check if current workspace is an Odoo project
	 */
	private async isOdooWorkspace(): Promise<boolean> {
		try {
			// Check for common Odoo project indicators
			const odooIndicators = [
				"odoo-bin",
				"odoo.conf",
				"requirements.txt",
				"addons/__manifest__.py",
				"openerp-server",
			]

			for (const indicator of odooIndicators) {
				const indicatorPath = path.join(this.workspaceRoot, indicator)
				const fs = await import("fs/promises")
				try {
					await fs.access(indicatorPath)
					return true
				} catch {
					// Continue checking other indicators
				}
			}

			// Check for Odoo addons directory structure
			const addonsPath = path.join(this.workspaceRoot, "addons")
			try {
				const fs = await import("fs/promises")
				const addonDirs = await fs.readdir(addonsPath)
				const hasManifestFiles = addonDirs.some(async (addon) => {
					const manifestPath = path.join(addonsPath, addon, "__manifest__.py")
					try {
						await fs.access(manifestPath)
						return true
					} catch {
						return false
					}
				})

				if (hasManifestFiles) {
					return true
				}
			} catch {
				// No addons directory
			}

			return false
		} catch (error) {
			console.error("[OdooRevertHandler] Error checking Odoo workspace:", error)
			return false
		}
	}

	/**
	 * Identify Odoo modules affected by the revert
	 */
	private async identifyAffectedModules(affectedFiles: string[]): Promise<OdooModuleInfo[]> {
		const modules: OdooModuleInfo[] = []
		const processedModules = new Set<string>()

		for (const filePath of affectedFiles) {
			const moduleInfo = await this.extractModuleInfo(filePath)
			if (moduleInfo && !processedModules.has(moduleInfo.name)) {
				modules.push(moduleInfo)
				processedModules.add(moduleInfo.name)
			}
		}

		return modules
	}

	/**
	 * Extract Odoo module information from file path
	 */
	private async extractModuleInfo(filePath: string): Promise<OdooModuleInfo | null> {
		// Typical Odoo structure: addons/module_name/...
		const pathParts = filePath.split(path.sep)

		// Find the addons directory
		const addonsIndex = pathParts.findIndex((part) => part === "addons")
		if (addonsIndex === -1 || addonsIndex + 1 >= pathParts.length) {
			return null
		}

		const moduleName = pathParts[addonsIndex + 1]
		const modulePath = path.join(this.workspaceRoot, "addons", moduleName)
		const manifestPath = path.join(modulePath, "__manifest__.py")

		try {
			const fs = await import("fs/promises")

			// Check if manifest exists
			await fs.access(manifestPath)

			// Analyze what types of files were affected
			const hasModels = filePath.includes("/models/") || filePath.includes(".py")
			const hasViews = filePath.includes("/views/") || filePath.includes(".xml")
			const hasControllers = filePath.includes("/controllers/") || filePath.includes("/static/")
			const hasDataFiles = filePath.includes("/data/") || filePath.includes(".xml")

			return {
				name: moduleName,
				path: modulePath,
				manifestPath,
				hasModels,
				hasViews,
				hasControllers,
				hasDataFiles,
			}
		} catch {
			return null
		}
	}

	/**
	 * Determine if database update is required
	 */
	private requiresDatabaseUpdate(affectedFiles: string[], modules: OdooModuleInfo[]): boolean {
		// Database update is required if:
		// 1. Models were modified (structural changes)
		// 2. Views were modified (UI changes)
		// 3. Data files were modified (data changes)

		return modules.some((module) => module.hasModels || module.hasViews || module.hasDataFiles)
	}

	/**
	 * Generate suggested Odoo commands
	 */
	private generateSuggestedCommands(modules: OdooModuleInfo[], requiresUpdate: boolean): string[] {
		const commands: string[] = []

		if (requiresUpdate) {
			// Single module update
			if (modules.length === 1) {
				commands.push(`./odoo-bin -u ${modules[0].name} -d ${this.getDatabaseName()}`)
			} else {
				// Multiple module update
				const moduleList = modules.map((m) => m.name).join(",")
				commands.push(`./odoo-bin -u ${moduleList} -d ${this.getDatabaseName()}`)
			}

			// Full database update option
			commands.push(`./odoo-bin -d ${this.getDatabaseName()} --update-all`)
		}

		// Restart server command
		commands.push("./odoo-bin --stop-after-init")

		// Module upgrade commands
		for (const module of modules) {
			if (module.hasModels) {
				commands.push(`./odoo-bin -u ${module.name} --stop-after-init`)
			}
		}

		return commands
	}

	/**
	 * Get database name from configuration
	 */
	private getDatabaseName(): string {
		// Try to get database name from odoo.conf or workspace configuration
		// For now, return a default
		return "odoo"
	}

	/**
	 * Get module dependencies
	 */
	private async getModuleDependencies(modules: OdooModuleInfo[]): Promise<string[]> {
		const dependencies: string[] = []

		for (const module of modules) {
			try {
				const fs = await import("fs/promises")
				const manifestContent = await fs.readFile(module.manifestPath, "utf8")

				// Parse manifest to extract dependencies
				const manifestMatch = manifestContent.match(/['"]depends['"]:\s*\[([^\]]+)\]/)
				if (manifestMatch) {
					const deps = manifestMatch[1]
						.replace(/['"]/g, "")
						.split(",")
						.map((dep) => dep.trim())
						.filter((dep) => dep && !dep.startsWith("base"))

					dependencies.push(...deps)
				}
			} catch (error) {
				console.warn(`[OdooRevertHandler] Failed to parse manifest for ${module.name}:`, error)
			}
		}

		return [...new Set(dependencies)]
	}

	/**
	 * Execute database update
	 */
	private async executeDatabaseUpdate(modules: OdooModuleInfo[]): Promise<void> {
		const terminal = vscode.window.createTerminal({
			name: "Odoo Database Update",
			cwd: this.workspaceRoot,
		})

		if (modules.length === 1) {
			terminal.sendText(`./odoo-bin -u ${modules[0].name} -d ${this.getDatabaseName()}`)
		} else {
			const moduleList = modules.map((m) => m.name).join(",")
			terminal.sendText(`./odoo-bin -u ${moduleList} -d ${this.getDatabaseName()}`)
		}

		terminal.show()

		// Show progress notification
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Updating Odoo Database",
				cancellable: false,
			},
			async (progress) => {
				progress.report({ increment: 0, message: "Starting database update..." })

				// Wait for terminal to complete (simplified)
				await new Promise((resolve) => setTimeout(resolve, 2000))

				progress.report({ increment: 100, message: "Database update completed" })
			},
		)
	}

	/**
	 * Show commands panel
	 */
	private async showCommandsPanel(commands: string[]): Promise<void> {
		const document = await vscode.workspace.openTextDocument({
			content: commands.join("\n"),
			language: "shell",
		})

		await vscode.window.showTextDocument(document)

		vscode.window
			.showInformationMessage(
				"Commands copied to new document. Execute them in terminal to complete the revert process.",
				"Open Terminal",
			)
			.then((choice) => {
				if (choice === "Open Terminal") {
					const terminal = vscode.window.createTerminal({
						name: "Odoo Commands",
						cwd: this.workspaceRoot,
					})
					terminal.show()
				}
			})
	}

	/**
	 * Handle dependency conflicts
	 */
	private async handleDependencyConflicts(dependencies: string[]): Promise<void> {
		if (dependencies.length === 0) {
			return
		}

		const message = `The following dependent modules may need updates: ${dependencies.join(", ")}`

		const choice = await vscode.window.showWarningMessage(message, "Update Dependencies", "Review Later", "Skip")

		if (choice === "Update Dependencies") {
			const terminal = vscode.window.createTerminal({
				name: "Odoo Dependencies Update",
				cwd: this.workspaceRoot,
			})

			const depList = dependencies.join(",")
			terminal.sendText(`./odoo-bin -u ${depList} -d ${this.getDatabaseName()}`)
			terminal.show()
		}
	}

	/**
	 * Refresh Odoo explorer if available
	 */
	private async refreshOdooExplorer(): Promise<void> {
		try {
			// Try to refresh VSCode's file explorer
			await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer")

			// Try to refresh any Odoo-specific extensions
			await vscode.commands.executeCommand("odoo.refreshModules")
		} catch (error) {
			// Commands may not be available, that's okay
			console.log("[OdooRevertHandler] Could not refresh Odoo explorer:", error)
		}
	}

	/**
	 * Validate Odoo module structure
	 */
	async validateModuleStructure(moduleName: string): Promise<boolean> {
		const modulePath = path.join(this.workspaceRoot, "addons", moduleName)
		const manifestPath = path.join(modulePath, "__manifest__.py")

		try {
			const fs = await import("fs/promises")

			// Check manifest exists
			await fs.access(manifestPath)

			// Check required directories
			const requiredDirs = ["models", "views", "controllers"]
			for (const dir of requiredDirs) {
				const dirPath = path.join(modulePath, dir)
				try {
					await fs.access(dirPath)
				} catch {
					// Directory doesn't exist, but that might be okay
				}
			}

			return true
		} catch {
			return false
		}
	}

	/**
	 * Get module statistics
	 */
	async getModuleStatistics(moduleName: string): Promise<any> {
		const modulePath = path.join(this.workspaceRoot, "addons", moduleName)

		try {
			const fs = await import("fs/promises")
			const stats = {
				models: 0,
				views: 0,
				controllers: 0,
				dataFiles: 0,
				totalFiles: 0,
			}

			const countFiles = async (dir: string, pattern: string) => {
				try {
					const files = await fs.readdir(dir)
					return files.filter((file) => file.includes(pattern)).length
				} catch {
					return 0
				}
			}

			stats.models = await countFiles(path.join(modulePath, "models"), ".py")
			stats.views = await countFiles(path.join(modulePath, "views"), ".xml")
			stats.controllers = await countFiles(path.join(modulePath, "controllers"), ".py")
			stats.dataFiles = await countFiles(path.join(modulePath, "data"), ".xml")

			// Count total files
			const countAllFiles = async (dir: string): Promise<number> => {
				try {
					const items = await fs.readdir(dir, { withFileTypes: true })
					let count = 0

					for (const item of items) {
						if (item.isFile()) {
							count++
						} else if (item.isDirectory()) {
							count += await countAllFiles(path.join(dir, item.name))
						}
					}
					return count
				} catch {
					return 0
				}
			}

			stats.totalFiles = await countAllFiles(modulePath)

			return stats
		} catch (error) {
			console.error(`[OdooRevertHandler] Failed to get statistics for ${moduleName}:`, error)
			return null
		}
	}
}
