// kilocode_change - new file

import { FileSystemService } from "./file-system-service"
import { ValidationService } from "./validation-service"
import { EditParser, ParsedEdit } from "./edit-parser"
import { DiffProvider } from "./diff-provider"
import * as vscode from "vscode"
import * as path from "path"

export interface OdooDependency {
	type: "model" | "view" | "data" | "security"
	sourceFile: string
	targetFile: string
	description: string
}

export interface MultiFilePatch {
	filePath: string
	edits: ParsedEdit[]
	dependencies: OdooDependency[]
}

/**
 * Enhanced executor with Odoo-specific cross-file dependency awareness
 */
export class OdooEnhancedExecutor {
	private odooModels: Map<string, string> = new Map() // model_name -> file_path
	private odooViews: Map<string, string[]> = new Map() // model_name -> [view_files]
	private odooDataFiles: string[] = []

	constructor(
		private fileSystemService: FileSystemService,
		private validationService: ValidationService,
		private workspaceRoot: string,
	) {
		this.analyzeOdooProject()
	}

	/**
	 * Analyze the Odoo project structure to understand dependencies
	 */
	private async analyzeOdooProject(): Promise<void> {
		try {
			await this.scanOdooModels()
			await this.scanOdooViews()
			await this.scanOdooDataFiles()
		} catch (error) {
			console.error("Error analyzing Odoo project:", error)
		}
	}

	/**
	 * Scan for Odoo models
	 */
	private async scanOdooModels(): Promise<void> {
		const fs = require("fs").promises
		const { glob } = require("glob")

		// Find Python model files
		const modelFiles = await glob("**/models/*.py", { cwd: this.workspaceRoot })

		for (const file of modelFiles) {
			try {
				const content = await fs.readFile(path.join(this.workspaceRoot, file), "utf8")
				const models = this.extractOdooModels(content)

				for (const model of models) {
					this.odooModels.set(model.name, file)
				}
			} catch (error) {
				console.error(`Error scanning model file ${file}:`, error)
			}
		}
	}

	/**
	 * Scan for Odoo views
	 */
	private async scanOdooViews(): Promise<void> {
		const fs = require("fs").promises
		const { glob } = require("glob")

		// Find XML view files
		const viewFiles = await glob("**/views/*.xml", { cwd: this.workspaceRoot })

		for (const file of viewFiles) {
			try {
				const content = await fs.readFile(path.join(this.workspaceRoot, file), "utf8")
				const viewModels = this.extractOdooViewModels(content)

				for (const model of viewModels) {
					if (!this.odooViews.has(model)) {
						this.odooViews.set(model, [])
					}
					this.odooViews.get(model)!.push(file)
				}
			} catch (error) {
				console.error(`Error scanning view file ${file}:`, error)
			}
		}
	}

	/**
	 * Scan for Odoo data files
	 */
	private async scanOdooDataFiles(): Promise<void> {
		const { glob } = require("glob")

		// Find data files
		const dataFiles = await glob("**/data/*.xml", { cwd: this.workspaceRoot })
		this.odooDataFiles.push(...dataFiles)
	}

	/**
	 * Extract Odoo models from Python content
	 */
	private extractOdooModels(content: string): Array<{ name: string; inherits?: string }> {
		const models: Array<{ name: string; inherits?: string }> = []

		// Match _name declarations
		const nameMatches = content.matchAll(/_name\s*=\s*['"]([^'"]+)['"]/g)
		for (const match of nameMatches) {
			const modelName = match[1]
			const inheritsMatch = content.match(/_inherit\s*=\s*['"]([^'"]+)['"]/)

			models.push({
				name: modelName,
				inherits: inheritsMatch ? inheritsMatch[1] : undefined,
			})
		}

		return models
	}

	/**
	 * Extract Odoo view models from XML content
	 */
	private extractOdooViewModels(content: string): string[] {
		const models: string[] = []

		// Match model attributes in view records
		const modelMatches = content.matchAll(/model\s*=\s*['"]([^'"]+)['"]/g)
		for (const match of modelMatches) {
			models.push(match[1])
		}

		return [...new Set(models)] // Remove duplicates
	}

	/**
	 * Apply multi-file patches with dependency awareness
	 */
	async applyMultiFilePatch(patches: MultiFilePatch[]): Promise<void> {
		// Analyze dependencies
		const dependencies = this.analyzeDependencies(patches)

		// Validate dependencies
		const validationIssues = this.validateDependencies(dependencies)
		if (validationIssues.length > 0) {
			const message = `Dependency issues found:\n${validationIssues.join("\n")}\n\nContinue anyway?`
			const result = await vscode.window.showWarningMessage(message, "Continue", "Cancel")
			if (result !== "Continue") {
				throw new Error("Patch application cancelled due to dependency issues")
			}
		}

		// Apply patches in dependency order
		const sortedPatches = this.sortPatchesByDependencies(patches, dependencies)

		// Start transaction
		const transactionId = await this.fileSystemService.startTransaction("Apply multi-file patch")

		try {
			for (const patch of sortedPatches) {
				// Validate each patch
				const validation = await this.validationService.validateEdits(patch.edits)
				if (!validation.isValid) {
					throw new Error(`Validation failed for ${patch.filePath}: ${validation.syntaxErrors.join(", ")}`)
				}

				// Apply edits
				await this.fileSystemService.applyEdits(patch.edits)

				// Show progress
				vscode.window.showInformationMessage(`Applied ${patch.edits.length} edits to ${patch.filePath}`)
			}

			await this.fileSystemService.commitTransaction()
		} catch (error) {
			await this.fileSystemService.rollbackTransaction()
			throw error
		}
	}

	/**
	 * Analyze dependencies between patches
	 */
	private analyzeDependencies(patches: MultiFilePatch[]): OdooDependency[] {
		const dependencies: OdooDependency[] = []

		for (const patch of patches) {
			// Analyze each edit for Odoo-specific dependencies
			for (const edit of patch.edits) {
				const editDependencies = this.analyzeEditDependencies(edit, patch.filePath)
				dependencies.push(...editDependencies)
			}
		}

		return dependencies
	}

	/**
	 * Analyze dependencies for a single edit
	 */
	private analyzeEditDependencies(edit: ParsedEdit, filePath: string): OdooDependency[] {
		const dependencies: OdooDependency[] = []

		// Check for model changes
		if (filePath.includes("/models/") && filePath.endsWith(".py")) {
			const modelChanges = this.analyzeModelEditDependencies(edit, filePath)
			dependencies.push(...modelChanges)
		}

		// Check for view changes
		if (filePath.includes("/views/") && filePath.endsWith(".xml")) {
			const viewChanges = this.analyzeViewEditDependencies(edit, filePath)
			dependencies.push(...viewChanges)
		}

		// Check for data changes
		if (filePath.includes("/data/") && filePath.endsWith(".xml")) {
			const dataChanges = this.analyzeDataEditDependencies(edit, filePath)
			dependencies.push(...dataChanges)
		}

		return dependencies
	}

	/**
	 * Analyze model edit dependencies
	 */
	private analyzeModelEditDependencies(edit: ParsedEdit, filePath: string): OdooDependency[] {
		const dependencies: OdooDependency[] = []

		// Extract model name from edit
		const modelName = this.extractModelNameFromEdit(edit)
		if (!modelName) return dependencies

		// Check if there are views that depend on this model
		const viewFiles = this.odooViews.get(modelName) || []
		for (const viewFile of viewFiles) {
			dependencies.push({
				type: "view",
				sourceFile: filePath,
				targetFile: viewFile,
				description: `Model ${modelName} changes may affect view ${viewFile}`,
			})
		}

		// Check for inheritance dependencies
		const inheritedModels = this.findInheritedModels(modelName)
		for (const inheritedModel of inheritedModels) {
			const inheritedFile = this.odooModels.get(inheritedModel)
			if (inheritedFile) {
				dependencies.push({
					type: "model",
					sourceFile: filePath,
					targetFile: inheritedFile,
					description: `Model ${modelName} inherits from ${inheritedModel}`,
				})
			}
		}

		return dependencies
	}

	/**
	 * Analyze view edit dependencies
	 */
	private analyzeViewEditDependencies(edit: ParsedEdit, filePath: string): OdooDependency[] {
		const dependencies: OdooDependency[] = []

		// Extract model name from view edit
		const modelName = this.extractModelNameFromViewEdit(edit)
		if (!modelName) return dependencies

		// Check if there's a corresponding model file
		const modelFile = this.odooModels.get(modelName)
		if (modelFile) {
			dependencies.push({
				type: "model",
				sourceFile: filePath,
				targetFile: modelFile,
				description: `View changes may require model ${modelName} updates`,
			})
		}

		return dependencies
	}

	/**
	 * Analyze data edit dependencies
	 */
	private analyzeDataEditDependencies(edit: ParsedEdit, filePath: string): OdooDependency[] {
		const dependencies: OdooDependency[] = []

		// Extract model name from data edit
		const modelName = this.extractModelNameFromDataEdit(edit)
		if (!modelName) return dependencies

		// Check if there's a corresponding model file
		const modelFile = this.odooModels.get(modelName)
		if (modelFile) {
			dependencies.push({
				type: "data",
				sourceFile: filePath,
				targetFile: modelFile,
				description: `Data changes for model ${modelName}`,
			})
		}

		return dependencies
	}

	/**
	 * Extract model name from edit content
	 */
	private extractModelNameFromEdit(edit: ParsedEdit): string | null {
		const content = edit.search || edit.replace || ""

		// Look for _name declarations
		const nameMatch = content.match(/_name\s*=\s*['"]([^'"]+)['"]/)
		return nameMatch ? nameMatch[1] : null
	}

	/**
	 * Extract model name from view edit
	 */
	private extractModelNameFromViewEdit(edit: ParsedEdit): string | null {
		const content = edit.search || edit.replace || ""

		// Look for model attributes
		const modelMatch = content.match(/model\s*=\s*['"]([^'"]+)['"]/)
		return modelMatch ? modelMatch[1] : null
	}

	/**
	 * Extract model name from data edit
	 */
	private extractModelNameFromDataEdit(edit: ParsedEdit): string | null {
		const content = edit.search || edit.replace || ""

		// Look for model attributes in data records
		const modelMatch = content.match(/model\s*=\s*['"]([^'"]+)['"]/)
		return modelMatch ? modelMatch[1] : null
	}

	/**
	 * Find models that inherit from the given model
	 */
	private findInheritedModels(modelName: string): string[] {
		const inherited: string[] = []

		for (const [name, file] of this.odooModels) {
			// This is a simplified check - in reality, you'd need to parse the file
			// to find _inherit declarations
			if (name !== modelName) {
				inherited.push(name)
			}
		}

		return inherited
	}

	/**
	 * Validate dependencies
	 */
	private validateDependencies(dependencies: OdooDependency[]): string[] {
		const issues: string[] = []

		for (const dep of dependencies) {
			// Check if target file exists
			const targetPath = path.join(this.workspaceRoot, dep.targetFile)
			if (!require("fs").existsSync(targetPath)) {
				issues.push(`Target file not found: ${dep.targetFile}`)
			}
		}

		return issues
	}

	/**
	 * Sort patches by dependencies
	 */
	private sortPatchesByDependencies(patches: MultiFilePatch[], dependencies: OdooDependency[]): MultiFilePatch[] {
		// Simple topological sort
		const sorted: MultiFilePatch[] = []
		const visited = new Set<string>()
		const visiting = new Set<string>()

		const visit = (patch: MultiFilePatch) => {
			if (visiting.has(patch.filePath)) {
				throw new Error(`Circular dependency detected: ${patch.filePath}`)
			}
			if (visited.has(patch.filePath)) {
				return
			}

			visiting.add(patch.filePath)

			// Visit dependencies first
			const deps = dependencies.filter((d) => d.sourceFile === patch.filePath)
			for (const dep of deps) {
				const depPatch = patches.find((p) => p.filePath === dep.targetFile)
				if (depPatch) {
					visit(depPatch)
				}
			}

			visiting.delete(patch.filePath)
			visited.add(patch.filePath)
			sorted.push(patch)
		}

		for (const patch of patches) {
			visit(patch)
		}

		return sorted
	}

	/**
	 * Get Odoo project statistics
	 */
	getOdooStats(): {
		models: number
		views: number
		dataFiles: number
		dependencies: number
	} {
		return {
			models: this.odooModels.size,
			views: Array.from(this.odooViews.values()).reduce((sum, views) => sum + views.length, 0),
			dataFiles: this.odooDataFiles.length,
			dependencies: 0, // Would be calculated from current patches
		}
	}

	/**
	 * Refresh Odoo project analysis
	 */
	async refreshAnalysis(): Promise<void> {
		this.odooModels.clear()
		this.odooViews.clear()
		this.odooDataFiles.length = 0

		await this.analyzeOdooProject()
	}
}
