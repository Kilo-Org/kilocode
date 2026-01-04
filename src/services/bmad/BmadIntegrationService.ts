// kilocode_change - new file for BMAD-METHOD core integration service

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as yaml from "yaml"

import type {
	BmadModule,
	BmadAgent,
	BmadWorkflow,
	BmadTemplate,
	BmadInstallation,
	AgentCapabilities,
	WorkflowExecutionOptions,
	WorkflowResult,
	BmadServiceEvent,
	BmadEventListener,
	ModuleValidationResult,
} from "./types"
import { BmadConfigManager, getBmadConfigManager, DEFAULT_BMAD_CONFIG } from "./config"
import { fileExistsAtPath } from "../../utils/fs"
import { logger } from "../../utils/logging"
import { t } from "../../i18n"

/**
 * BMAD Integration Service
 * Core service for managing BMAD-METHOD integration with Kilo Code
 */
export class BmadIntegrationService {
	private configManager: BmadConfigManager
	private modules: Map<string, BmadModule> = new Map()
	private agents: Map<string, BmadAgent> = new Map()
	private workflows: Map<string, BmadWorkflow> = new Map()
	private templates: Map<string, BmadTemplate> = new Map()
	private eventListeners: Set<BmadEventListener> = new Set()
	private isInitialized = false
	private disposables: vscode.Disposable[] = []
	private embeddedModulesLoaded: Set<string> = new Set() // Track modules loaded from embedded assets

	constructor(private readonly context: vscode.ExtensionContext) {
		this.configManager = getBmadConfigManager(context)
	}

	/**
	 * Initialize the BMAD integration service
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			logger.warn("[BmadIntegrationService] Already initialized")
			return
		}

		try {
			logger.info("[BmadIntegrationService] Initializing...")

			// Initialize configuration manager
			await this.configManager.initialize()

			// Check if BMAD is enabled
			if (!this.configManager.isEnabled()) {
				logger.info("[BmadIntegrationService] BMAD integration is disabled")
				this.isInitialized = true
				this.emitEvent({ type: "initialized", data: this.getInstallationInfo() })
				return
			}

			// Validate BMAD installation
			const installation = await this.validateInstallation()
			if (!installation.isValid) {
				logger.warn("[BmadIntegrationService] BMAD installation validation failed", {
					errors: installation.validationErrors,
				})
				this.isInitialized = true
				this.emitEvent({ type: "initialized", data: installation })
				return
			}

			// Load BMAD modules
			await this.loadModules()

			// Load agents from modules
			await this.loadAgents()

			// Load workflows from modules
			await this.loadWorkflows()

			// Load templates from modules
			await this.loadTemplates()

			this.isInitialized = true

			logger.info("[BmadIntegrationService] Initialized successfully", {
				modules: this.modules.size,
				agents: this.agents.size,
				workflows: this.workflows.size,
				templates: this.templates.size,
			})

			this.emitEvent({ type: "initialized", data: this.getInstallationInfo() })
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadIntegrationService] Failed to initialize", { error: errorMessage })
			this.emitEvent({
				type: "error",
				data: { message: "Failed to initialize BMAD integration", details: errorMessage },
			})
			this.isInitialized = true // Mark as initialized even if failed to prevent retry loops
		}
	}

	/**
	 * Validate BMAD installation
	 */
	private async validateInstallation(): Promise<BmadInstallation> {
		const installationPath = this.configManager.getInstallationPath()
		const validationErrors: string[] = []
		let hasAnyModules = false

		try {
			// Check if installation path exists
			const externalExists = await fileExistsAtPath(installationPath)

			// Check if embedded assets path exists
			const embeddedPath = vscode.Uri.joinPath(this.context.extensionUri, "assets", "bmad")
			try {
				const embeddedStat = await vscode.workspace.fs.stat(embeddedPath)
				hasAnyModules = embeddedStat.type === vscode.FileType.Directory
			} catch {
				hasAnyModules = false
			}

			// If neither external nor embedded exists, report error
			if (!externalExists && !hasAnyModules) {
				validationErrors.push(`BMAD installation path does not exist: ${installationPath}`)
				return {
					version: "unknown",
					installedAt: new Date(),
					modules: [],
					config: this.configManager.getConfig(),
					isValid: false,
					validationErrors,
				}
			}

			// Check for core config file (in external path or embedded)
			let coreConfigExists = false
			if (externalExists) {
				const coreConfigPath = path.join(installationPath, "core", "config.yaml")
				coreConfigExists = await fileExistsAtPath(coreConfigPath)
			} else if (hasAnyModules) {
				// Check in embedded path
				const embeddedCorePath = vscode.Uri.joinPath(embeddedPath, "core", "config.yaml")
				try {
					await vscode.workspace.fs.stat(embeddedCorePath)
					coreConfigExists = true
				} catch {
					coreConfigExists = false
				}
			}

			if (!coreConfigExists) {
				validationErrors.push("BMAD core config file not found")
			}

			// Read version if available
			let version = "unknown"
			if (externalExists) {
				const versionPath = path.join(installationPath, "VERSION")
				const versionExists = await fileExistsAtPath(versionPath)
				if (versionExists) {
					try {
						version = await fs.readFile(versionPath, "utf-8")
						version = version.trim()
					} catch {
						// Ignore version read errors
					}
				}
			} else if (hasAnyModules) {
				// Try to read version from embedded assets
				const embeddedVersionPath = vscode.Uri.joinPath(embeddedPath, "VERSION")
				try {
					const versionContent = await vscode.workspace.fs.readFile(embeddedVersionPath)
					version = new TextDecoder().decode(versionContent).trim()
				} catch {
					// Use default version
				}
			}

			return {
				version,
				installedAt: new Date(),
				modules: [],
				config: this.configManager.getConfig(),
				isValid: validationErrors.length === 0,
				validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			validationErrors.push(`Validation error: ${errorMessage}`)
			return {
				version: "unknown",
				installedAt: new Date(),
				modules: [],
				config: this.configManager.getConfig(),
				isValid: false,
				validationErrors,
			}
		}
	}

	/**
	 * Load BMAD modules
	 */
	private async loadModules(): Promise<void> {
		const installationPath = this.configManager.getInstallationPath()
		const activeModules = this.configManager.getActiveModules()
		this.embeddedModulesLoaded.clear()

		for (const moduleId of activeModules) {
			// First, try to load from external installation path
			const externalModulePath = path.join(installationPath, moduleId)
			const externalExists = await fileExistsAtPath(externalModulePath)

			if (externalExists) {
				try {
					const module = await this.loadModule(moduleId, externalModulePath)
					if (module) {
						this.modules.set(moduleId, module)
						this.emitEvent({ type: "moduleLoaded", data: module })
						logger.info("[BmadIntegrationService] Loaded external module", { moduleId, name: module.name })
						continue // Successfully loaded from external, skip embedded
					}
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					logger.error("[BmadIntegrationService] Failed to load external module", {
						moduleId,
						error: errorMessage,
					})
				}
			}

			// Fallback: Try to load from embedded assets
			try {
				const loaded = await this.loadEmbeddedModule(moduleId)
				if (loaded) {
					logger.info("[BmadIntegrationService] Loaded embedded module", { moduleId })
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				logger.warn("[BmadIntegrationService] Module not found in external or embedded", {
					moduleId,
					error: errorMessage,
				})
			}
		}

		// Load any custom modules if specified
		const customModulesPath = this.configManager.getConfig().customModulesPath
		if (customModulesPath) {
			await this.loadCustomModules(customModulesPath, activeModules)
		}
	}

	/**
	 * Load a module from embedded assets
	 */
	private async loadEmbeddedModule(moduleId: string): Promise<boolean> {
		const embeddedPath = vscode.Uri.joinPath(this.context.extensionUri, "assets", "bmad", moduleId)

		try {
			// Check if module directory exists in embedded assets
			const stat = await vscode.workspace.fs.stat(embeddedPath)
			if (stat.type !== vscode.FileType.Directory) {
				return false
			}

			// Read module config
			const configUri = vscode.Uri.joinPath(embeddedPath, "config.yaml")
			try {
				await vscode.workspace.fs.stat(configUri)
			} catch {
				logger.warn("[BmadIntegrationService] Embedded module config not found", { moduleId })
				return false
			}

			const configContent = await vscode.workspace.fs.readFile(configUri)
			const config = yaml.parse(new TextDecoder().decode(configContent))

			// Read metadata if available
			let metadata: any = {}
			const metadataUri = vscode.Uri.joinPath(embeddedPath, "metadata.yaml")
			try {
				const metadataContent = await vscode.workspace.fs.readFile(metadataUri)
				metadata = yaml.parse(new TextDecoder().decode(metadataContent))
			} catch {
				// Metadata is optional
			}

			// Convert URI to filesystem path for the module
			const modulePath = embeddedPath.fsPath

			const module: BmadModule = {
				id: moduleId,
				name: metadata.name || moduleId,
				version: metadata.version || "1.0.0-embedded",
				description: metadata.description || `Embedded ${moduleId} module`,
				installedPath: modulePath,
				agents: [],
				workflows: [],
				templates: [],
				config: config,
			}

			this.modules.set(moduleId, module)
			this.embeddedModulesLoaded.add(moduleId)
			this.emitEvent({ type: "moduleLoaded", data: module })

			return true
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadIntegrationService] Failed to load embedded module", { moduleId, error: errorMessage })
			return false
		}
	}

	/**
	 * Load custom modules from a specific path
	 */
	private async loadCustomModules(customPath: string, activeModules: string[]): Promise<void> {
		for (const moduleId of activeModules) {
			// Skip if module already loaded
			if (this.modules.has(moduleId)) {
				continue
			}

			const modulePath = path.join(customPath, moduleId)
			const exists = await fileExistsAtPath(modulePath)

			if (!exists) {
				continue
			}

			try {
				const module = await this.loadModule(moduleId, modulePath)
				if (module) {
					this.modules.set(moduleId, module)
					this.emitEvent({ type: "moduleLoaded", data: module })
					logger.info("[BmadIntegrationService] Loaded custom module", { moduleId, name: module.name })
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				logger.error("[BmadIntegrationService] Failed to load custom module", { moduleId, error: errorMessage })
			}
		}
	}

	/**
	 * Load a single BMAD module
	 */
	private async loadModule(moduleId: string, modulePath: string): Promise<BmadModule | null> {
		try {
			const configPath = path.join(modulePath, "config.yaml")
			const configExists = await fileExistsAtPath(configPath)

			if (!configExists) {
				logger.warn("[BmadIntegrationService] Module config not found", { moduleId })
				return null
			}

			const configContent = await fs.readFile(configPath, "utf-8")
			const config = yaml.parse(configContent)

			// Load module metadata
			const metadataPath = path.join(modulePath, "metadata.yaml")
			let metadata: any = {}
			try {
				const metadataExists = await fileExistsAtPath(metadataPath)
				if (metadataExists) {
					const metadataContent = await fs.readFile(metadataPath, "utf-8")
					metadata = yaml.parse(metadataContent)
				}
			} catch {
				// Ignore metadata errors
			}

			return {
				id: moduleId,
				name: metadata.name || moduleId,
				version: metadata.version || "1.0.0",
				description: metadata.description || "",
				installedPath: modulePath,
				agents: [], // Will be populated separately
				workflows: [], // Will be populated separately
				templates: [], // Will be populated separately
				config: config,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadIntegrationService] Failed to load module config", { moduleId, error: errorMessage })
			return null
		}
	}

	/**
	 * Load agents from modules
	 */
	private async loadAgents(): Promise<void> {
		for (const [moduleId, module] of Array.from(this.modules)) {
			try {
				const agentsPath = path.join(module.installedPath, "agents")
				const exists = await fileExistsAtPath(agentsPath)

				if (!exists) {
					continue
				}

				const agentFiles = await fs.readdir(agentsPath)
				const yamlFiles = agentFiles.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))

				for (const agentFile of yamlFiles) {
					try {
						const agentPath = path.join(agentsPath, agentFile)
						const agent = await this.loadAgent(moduleId, agentPath)
						if (agent) {
							this.agents.set(agent.id, agent)
							module.agents.push(agent)
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error)
						logger.error("[BmadIntegrationService] Failed to load agent", {
							moduleId,
							agentFile,
							error: errorMessage,
						})
					}
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				logger.error("[BmadIntegrationService] Failed to load agents for module", {
					moduleId,
					error: errorMessage,
				})
			}
		}
	}

	/**
	 * Load a single agent
	 */
	private async loadAgent(moduleId: string, agentPath: string): Promise<BmadAgent | null> {
		try {
			const content = await fs.readFile(agentPath, "utf-8")
			const data = yaml.parse(content)

			if (!data || !data.metadata || !data.metadata.id) {
				logger.warn("[BmadIntegrationService] Invalid agent file", { agentPath })
				return null
			}

			return {
				id: data.metadata.id,
				name: data.metadata.name || data.metadata.id,
				displayName: data.metadata.displayName,
				title: data.metadata.title,
				icon: data.metadata.icon,
				role: data.role || "",
				identity: data.identity || "",
				communicationStyle: data.communicationStyle || "",
				principles: data.principles || [],
				capabilities: data.capabilities || [],
				triggers: data.triggers || [],
				moduleId: moduleId,
				metadata: data.metadata,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadIntegrationService] Failed to parse agent file", {
				agentPath,
				error: errorMessage,
			})
			return null
		}
	}

	/**
	 * Load workflows from modules
	 */
	private async loadWorkflows(): Promise<void> {
		for (const [moduleId, module] of Array.from(this.modules)) {
			try {
				const workflowsPath = path.join(module.installedPath, "workflows")
				const exists = await fileExistsAtPath(workflowsPath)

				if (!exists) {
					continue
				}

				// Recursively find workflow files
				const workflowFiles = await this.findWorkflowFiles(workflowsPath)

				for (const workflowFile of workflowFiles) {
					try {
						const workflow = await this.loadWorkflow(moduleId, workflowFile)
						if (workflow) {
							this.workflows.set(workflow.id, workflow)
							module.workflows.push(workflow)
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error)
						logger.error("[BmadIntegrationService] Failed to load workflow", {
							moduleId,
							workflowFile,
							error: errorMessage,
						})
					}
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				logger.error("[BmadIntegrationService] Failed to load workflows for module", {
					moduleId,
					error: errorMessage,
				})
			}
		}
	}

	/**
	 * Recursively find workflow files
	 */
	private async findWorkflowFiles(dirPath: string): Promise<string[]> {
		const workflowFiles: string[] = []

		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true })

			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name)

				if (entry.isDirectory()) {
					// Recursively search subdirectories
					const subFiles = await this.findWorkflowFiles(fullPath)
					workflowFiles.push(...subFiles)
				} else if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
					// Check if it's a workflow file (has workflow metadata)
					const content = await fs.readFile(fullPath, "utf-8")
					const data = yaml.parse(content)
					if (data && (data.name || data.workflow)) {
						workflowFiles.push(fullPath)
					}
				}
			}
		} catch (error) {
			logger.error("[BmadIntegrationService] Failed to read directory", { dirPath, error })
		}

		return workflowFiles
	}

	/**
	 * Load a single workflow
	 */
	private async loadWorkflow(moduleId: string, workflowPath: string): Promise<BmadWorkflow | null> {
		try {
			const content = await fs.readFile(workflowPath, "utf-8")
			const data = yaml.parse(content)

			if (!data || (!data.name && !data.workflow)) {
				logger.warn("[BmadIntegrationService] Invalid workflow file", { workflowPath })
				return null
			}

			// Generate workflow ID - use path relative to module or workspace
			let workflowId: string
			const module = this.modules.get(moduleId)
			if (module) {
				// Use path relative to module installed path
				const relativePath = path.relative(module.installedPath, workflowPath)
				workflowId = relativePath.replace(/[/\\]/g, ":").replace(/\.(yaml|yml)$/, "")
			} else {
				// Fallback to full path-based ID
				workflowId = workflowPath.replace(/[/\\]/g, ":").replace(/\.(yaml|yml)$/, "")
			}

			return {
				id: workflowId,
				name: data.name || data.workflow || workflowId,
				description: data.description || "",
				moduleId: moduleId,
				installedPath: path.dirname(workflowPath),
				steps: data.steps || [],
				config: data.config || {},
				standalone: data.standalone,
				webBundle: data.webBundle,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadIntegrationService] Failed to parse workflow file", {
				workflowPath,
				error: errorMessage,
			})
			return null
		}
	}

	/**
	 * Load templates from modules
	 */
	private async loadTemplates(): Promise<void> {
		for (const [moduleId, module] of Array.from(this.modules)) {
			try {
				const templatesPath = path.join(module.installedPath, "templates")
				const exists = await fileExistsAtPath(templatesPath)

				if (!exists) {
					continue
				}

				const templateDirs = await fs.readdir(templatesPath, { withFileTypes: true })

				for (const dir of templateDirs) {
					if (!dir.isDirectory()) continue

					try {
						const templatePath = path.join(templatesPath, dir.name)
						const template = await this.loadTemplate(moduleId, templatePath)
						if (template) {
							this.templates.set(template.id, template)
							module.templates.push(template)
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error)
						logger.error("[BmadIntegrationService] Failed to load template", {
							moduleId,
							templateName: dir.name,
							error: errorMessage,
						})
					}
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				logger.error("[BmadIntegrationService] Failed to load templates for module", {
					moduleId,
					error: errorMessage,
				})
			}
		}
	}

	/**
	 * Load a single template
	 */
	private async loadTemplate(moduleId: string, templatePath: string): Promise<BmadTemplate | null> {
		try {
			const configPath = path.join(templatePath, "template.yaml")
			const configExists = await fileExistsAtPath(configPath)

			if (!configExists) {
				return null
			}

			const configContent = await fs.readFile(configPath, "utf-8")
			const config = yaml.parse(configContent)

			// Load template files
			const files: any[] = []
			const filesPath = path.join(templatePath, "files")
			const filesExists = await fileExistsAtPath(filesPath)

			if (filesExists) {
				const fileEntries = await fs.readdir(filesPath, { withFileTypes: true })
				for (const entry of fileEntries) {
					if (!entry.isFile()) continue

					const filePath = path.join(filesPath, entry.name)
					const content = await fs.readFile(filePath, "utf-8")
					files.push({
						path: entry.name,
						content,
						encoding: "utf-8",
					})
				}
			}

			return {
				id: config.id || path.basename(templatePath),
				name: config.name || path.basename(templatePath),
				description: config.description || "",
				moduleId: moduleId,
				installedPath: templatePath,
				files,
				variables: config.variables || [],
				config: config.config,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadIntegrationService] Failed to load template", {
				templatePath,
				error: errorMessage,
			})
			return null
		}
	}

	/**
	 * Get all available modules
	 */
	getAvailableModules(): BmadModule[] {
		return Array.from(this.modules.values())
	}

	/**
	 * Get module by ID
	 */
	getModule(moduleId: string): BmadModule | undefined {
		return this.modules.get(moduleId)
	}

	/**
	 * Get workflows for a module
	 */
	getModuleWorkflows(moduleId: string): BmadWorkflow[] {
		const module = this.modules.get(moduleId)
		if (!module) return []
		return module.workflows
	}

	/**
	 * Get agents for a module
	 */
	getModuleAgents(moduleId: string): BmadAgent[] {
		const module = this.modules.get(moduleId)
		if (!module) return []
		return module.agents
	}

	/**
	 * Get agent by ID
	 */
	getAgent(agentId: string): BmadAgent | undefined {
		return this.agents.get(agentId)
	}

	/**
	 * Get all agents
	 */
	getAllAgents(): BmadAgent[] {
		return Array.from(this.agents.values())
	}

	/**
	 * Get workflow by ID
	 */
	getWorkflow(workflowId: string): BmadWorkflow | undefined {
		return this.workflows.get(workflowId)
	}

	/**
	 * Get workflow by ID (alias for getWorkflow)
	 */
	getWorkflowById(workflowId: string): BmadWorkflow | undefined {
		return this.workflows.get(workflowId)
	}

	/**
	 * Get all workflows
	 */
	getAllWorkflows(): BmadWorkflow[] {
		return Array.from(this.workflows.values())
	}

	/**
	 * Get all templates
	 */
	getAllTemplates(): BmadTemplate[] {
		return Array.from(this.templates.values())
	}

	/**
	 * Get templates for a module
	 */
	getModuleTemplates(moduleId: string): BmadTemplate[] {
		const module = this.modules.get(moduleId)
		if (!module) return []
		return module.templates
	}

	/**
	 * Get agent capabilities
	 */
	getAgentCapabilities(agentId: string): AgentCapabilities | null {
		const agent = this.agents.get(agentId)
		if (!agent) return null

		// Determine capabilities based on agent role and triggers
		return {
			canWriteFiles: true,
			canExecuteCommands: true,
			canReadFiles: true,
			canUseBrowser: agent.triggers.some((t) => t.workflow?.includes("browser")),
			canUseMcp: true,
			supportedTools: ["read_file", "write_to_file", "execute_command", "list_files"],
		}
	}

	/**
	 * Execute a workflow
	 */
	async executeWorkflow(workflowId: string, options: WorkflowExecutionOptions = {}): Promise<WorkflowResult> {
		const workflow = this.workflows.get(workflowId)
		if (!workflow) {
			throw new Error(`Workflow not found: ${workflowId}`)
		}

		// Workflow execution will be implemented in the WorkflowEngine
		// For now, return a placeholder result
		return {
			success: false,
			sessionId: "",
			outputs: {},
			error: "Workflow execution not yet implemented",
			completedSteps: [],
			failedSteps: [],
			duration: 0,
		}
	}

	/**
	 * Validate a module
	 */
	async validateModule(moduleId: string): Promise<ModuleValidationResult> {
		const module = this.modules.get(moduleId)
		if (!module) {
			return {
				isValid: false,
				moduleId,
				errors: [{ path: moduleId, message: "Module not found", code: "NOT_FOUND" }],
				warnings: [],
			}
		}

		const errors: any[] = []
		const warnings: any[] = []

		// Validate module structure
		if (!module.name || module.name.trim() === "") {
			errors.push({ path: `${moduleId}.name`, message: "Module name is required", code: "MISSING_NAME" })
		}

		if (!module.version || module.version.trim() === "") {
			warnings.push({
				path: `${moduleId}.version`,
				message: "Module version is missing",
				code: "MISSING_VERSION",
			})
		}

		// Validate agents
		if (module.agents.length === 0) {
			warnings.push({ path: `${moduleId}.agents`, message: "Module has no agents", code: "NO_AGENTS" })
		}

		return {
			isValid: errors.length === 0,
			moduleId,
			errors,
			warnings,
		}
	}

	/**
	 * Get installation information
	 */
	private getInstallationInfo(): BmadInstallation {
		return {
			version: "6.0.0-alpha.22", // From installed BMAD package
			installedAt: new Date(),
			modules: Array.from(this.modules.values()),
			config: this.configManager.getConfig(),
			isValid: this.modules.size > 0,
		}
	}

	/**
	 * Emit an event to all listeners
	 */
	private emitEvent(event: BmadServiceEvent): void {
		for (const listener of Array.from(this.eventListeners)) {
			try {
				listener(event)
			} catch (error) {
				logger.error("[BmadIntegrationService] Event listener error", { error })
			}
		}
	}

	/**
	 * Add an event listener
	 */
	addEventListener(listener: BmadEventListener): void {
		this.eventListeners.add(listener)
	}

	/**
	 * Remove an event listener
	 */
	removeEventListener(listener: BmadEventListener): void {
		this.eventListeners.delete(listener)
	}

	/**
	 * Check if the service is initialized
	 */
	isReady(): boolean {
		return this.isInitialized
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		logger.info("[BmadIntegrationService] Disposing...")

		for (const disposable of this.disposables) {
			disposable.dispose()
		}
		this.disposables = []

		this.modules.clear()
		this.agents.clear()
		this.workflows.clear()
		this.templates.clear()
		this.eventListeners.clear()

		this.isInitialized = false

		logger.info("[BmadIntegrationService] Disposed")
	}
}

/**
 * Get the BMAD integration service instance
 */
let integrationServiceInstance: BmadIntegrationService | null = null

export function getBmadIntegrationService(context: vscode.ExtensionContext): BmadIntegrationService {
	if (!integrationServiceInstance) {
		integrationServiceInstance = new BmadIntegrationService(context)
	}
	return integrationServiceInstance
}

export function disposeBmadIntegrationService(): void {
	if (integrationServiceInstance) {
		integrationServiceInstance.dispose()
		integrationServiceInstance = null
	}
}
