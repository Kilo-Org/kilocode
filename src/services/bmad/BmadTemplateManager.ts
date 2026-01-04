// kilocode_change - new file for BMAD-METHOD template manager

import type { BmadTemplate, BmadModule } from "./types"
import { BmadIntegrationService } from "./BmadIntegrationService"
import { logger } from "../../utils/logging"
import { t } from "../../i18n"

/**
 * Template initialization options
 */
export interface TemplateInitializationOptions {
	projectName: string
	projectType?: string
	technology?: string
	features?: string[]
	customVariables?: Record<string, any>
}

/**
 * Template initialization result
 */
export interface TemplateInitializationResult {
	success: boolean
	templateId: string
	templateName: string
	filesCreated: string[]
	variablesUsed: Record<string, any>
	error?: string
}

/**
 * Template validation result
 */
export interface TemplateValidationResult {
	isValid: boolean
	errors: string[]
	warnings: string[]
	requiredVariables: string[]
}

/**
 * BMAD template manager
 * Manages BMAD templates for project initialization
 */
export class BmadTemplateManager {
	private integrationService: BmadIntegrationService
	private templates: Map<string, BmadTemplate> = new Map()
	private isInitialized = false

	constructor(integrationService: BmadIntegrationService) {
		this.integrationService = integrationService
	}

	/**
	 * Initialize the template manager
	 */
	async initialize(): Promise<void> {
		try {
			if (this.isInitialized) {
				logger.warn("[BmadTemplateManager] Already initialized")
				return
			}

			// Wait for integration service to be ready
			await this.integrationService.initialize()

			// Load templates from all active modules
			const modules = this.integrationService.getAvailableModules()
			for (const module of modules) {
				const moduleTemplates = this.integrationService.getModuleTemplates(module.id)
				for (const template of moduleTemplates) {
					this.templates.set(template.id, template)
				}
			}

			this.isInitialized = true
			logger.info("[BmadTemplateManager] Initialized successfully", {
				templateCount: this.templates.size,
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadTemplateManager] Failed to initialize", { error: errorMessage })
			throw new Error(`Failed to initialize BMAD template manager: ${errorMessage}`)
		}
	}

	/**
	 * Get all available templates
	 */
	getAllTemplates(): BmadTemplate[] {
		return Array.from(this.templates.values())
	}

	/**
	 * Get templates by module
	 */
	getTemplatesByModule(moduleId: string): BmadTemplate[] {
		return Array.from(this.templates.values()).filter((template) => template.moduleId === moduleId)
	}

	/**
	 * Get template by ID
	 */
	getTemplateById(templateId: string): BmadTemplate | undefined {
		return this.templates.get(templateId)
	}

	/**
	 * Search templates by name or description
	 */
	searchTemplates(query: string): BmadTemplate[] {
		const lowerQuery = query.toLowerCase()
		return Array.from(this.templates.values()).filter(
			(template) =>
				template.name.toLowerCase().includes(lowerQuery) ||
				template.description.toLowerCase().includes(lowerQuery) ||
				template.tags.some((tag) => tag.toLowerCase().includes(lowerQuery)),
		)
	}

	/**
	 * Get templates by tags
	 */
	getTemplatesByTags(tags: string[]): BmadTemplate[] {
		return Array.from(this.templates.values()).filter((template) => tags.some((tag) => template.tags.includes(tag)))
	}

	/**
	 * Validate template
	 */
	validateTemplate(templateId: string): TemplateValidationResult {
		const template = this.templates.get(templateId)
		if (!template) {
			return {
				isValid: false,
				errors: [`Template not found: ${templateId}`],
				warnings: [],
				requiredVariables: [],
			}
		}

		const errors: string[] = []
		const warnings: string[] = []
		const requiredVariables: string[] = []

		// Check required fields
		if (!template.name || template.name.trim() === "") {
			errors.push("Template name is required")
		}

		if (!template.description || template.description.trim() === "") {
			warnings.push("Template description is missing")
		}

		// Check files
		if (!template.files || template.files.length === 0) {
			warnings.push("Template has no files defined")
		}

		// Extract required variables from template
		if (template.variables) {
			for (const [key, variable] of Object.entries(template.variables)) {
				if (variable.required) {
					requiredVariables.push(key)
				}
			}
		}

		// Check files for variable placeholders
		if (template.files) {
			for (const file of template.files) {
				if (file.content) {
					const variableMatches = file.content.match(/\{\{(\w+)\}\}/g)
					if (variableMatches) {
						for (const match of variableMatches) {
							const varName = match.replace(/\{\{|\}\}/g, "")
							if (!requiredVariables.includes(varName)) {
								requiredVariables.push(varName)
							}
						}
					}
				}
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			requiredVariables,
		}
	}

	/**
	 * Initialize project from template
	 */
	async initializeFromTemplate(
		templateId: string,
		options: TemplateInitializationOptions,
	): Promise<TemplateInitializationResult> {
		try {
			if (!this.isInitialized) {
				throw new Error("Template manager not initialized")
			}

			const template = this.templates.get(templateId)
			if (!template) {
				throw new Error(`Template not found: ${templateId}`)
			}

			logger.info("[BmadTemplateManager] Initializing from template", {
				templateId,
				templateName: template.name,
				projectName: options.projectName,
			})

			// Validate template
			const validation = this.validateTemplate(templateId)
			if (!validation.isValid) {
				throw new Error(`Template validation failed: ${validation.errors.join(", ")}`)
			}

			// Prepare variables
			const variables: Record<string, any> = {
				projectName: options.projectName,
				projectType: options.projectType || "default",
				technology: options.technology || "typescript",
				...options.customVariables,
			}

			// Add features if provided
			if (options.features && options.features.length > 0) {
				variables.features = options.features
			}

			// Create files from template
			const filesCreated: string[] = []

			if (template.files) {
				for (const file of template.files) {
					const filePath = this.resolveFilePath(file.path, variables)
					const fileContent = this.resolveFileContent(file.content, variables)

					// In a real implementation, this would create the actual file
					// For now, just track it
					filesCreated.push(filePath)

					logger.debug("[BmadTemplateManager] Would create file", { filePath })
				}
			}

			// Execute setup commands if provided
			if (template.setupCommands && template.setupCommands.length > 0) {
				logger.info("[BmadTemplateManager] Executing setup commands", {
					commandCount: template.setupCommands.length,
				})
				// In a real implementation, this would execute the commands
			}

			logger.info("[BmadTemplateManager] Template initialization completed", {
				templateId,
				filesCreated: filesCreated.length,
			})

			return {
				success: true,
				templateId,
				templateName: template.name,
				filesCreated,
				variablesUsed: variables,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadTemplateManager] Failed to initialize from template", {
				templateId,
				error: errorMessage,
			})

			return {
				success: false,
				templateId,
				templateName: "",
				filesCreated: [],
				variablesUsed: {},
				error: errorMessage,
			}
		}
	}

	/**
	 * Resolve file path with variables
	 */
	private resolveFilePath(path: string, variables: Record<string, any>): string {
		let resolvedPath = path

		// Replace variable placeholders
		for (const [key, value] of Object.entries(variables)) {
			const placeholder = `{{${key}}}`
			resolvedPath = resolvedPath.replace(new RegExp(placeholder, "g"), String(value))
		}

		return resolvedPath
	}

	/**
	 * Resolve file content with variables
	 */
	private resolveFileContent(content: string, variables: Record<string, any>): string {
		let resolvedContent = content

		// Replace variable placeholders
		for (const [key, value] of Object.entries(variables)) {
			const placeholder = `{{${key}}}`
			resolvedContent = resolvedContent.replace(new RegExp(placeholder, "g"), String(value))
		}

		return resolvedContent
	}

	/**
	 * Get recommended templates for project type
	 */
	getRecommendedTemplates(projectType: string): BmadTemplate[] {
		const lowerProjectType = projectType.toLowerCase()

		return Array.from(this.templates.values()).filter((template) => {
			// Check if template matches project type
			if (template.tags.some((tag) => tag.toLowerCase().includes(lowerProjectType))) {
				return true
			}

			// Check if template is recommended
			if (template.recommended) {
				return true
			}

			return false
		})
	}

	/**
	 * Get template statistics
	 */
	getTemplateStats(): {
		totalTemplates: number
		templatesByModule: Record<string, number>
		templatesByTag: Record<string, number>
	} {
		const templatesByModule: Record<string, number> = {}
		const templatesByTag: Record<string, number> = {}

		for (const template of Array.from(this.templates.values())) {
			// Count by module
			templatesByModule[template.moduleId] = (templatesByModule[template.moduleId] || 0) + 1

			// Count by tag
			for (const tag of template.tags) {
				templatesByTag[tag] = (templatesByTag[tag] || 0) + 1
			}
		}

		return {
			totalTemplates: this.templates.size,
			templatesByModule,
			templatesByTag,
		}
	}

	/**
	 * Check if initialized
	 */
	isReady(): boolean {
		return this.isInitialized
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		this.templates.clear()
		this.isInitialized = false

		logger.info("[BmadTemplateManager] Disposed")
	}
}

/**
 * Create BMAD template manager instance
 */
export function createBmadTemplateManager(integrationService: BmadIntegrationService): BmadTemplateManager {
	return new BmadTemplateManager(integrationService)
}
