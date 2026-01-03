// kilocode_change - new file

import * as path from "path"
import type { DiscoveredWorkflow, WorkflowDiscoveryConfig, WorkflowDiscoveryResult, WorkflowCacheEntry } from "./types"
import { WorkflowScanner } from "./WorkflowScanner"

/**
 * Default configuration for workflow discovery
 */
const DEFAULT_CONFIG: WorkflowDiscoveryConfig = {
	includeGlobal: true,
	includeWorkspace: true,
	enableCache: true,
	cacheTtlMs: 5 * 60 * 1000, // 5 minutes
}

/**
 * Main service for discovering workflows in global and workspace directories
 */
export class WorkflowDiscoveryService {
	private scanner: WorkflowScanner
	private config: WorkflowDiscoveryConfig
	private cache: Map<string, WorkflowCacheEntry>

	constructor(config?: Partial<WorkflowDiscoveryConfig>) {
		this.scanner = new WorkflowScanner()
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.cache = new Map()
	}

	/**
	 * Discover all workflows (global and workspace)
	 * @param cwd - Current working directory
	 * @param enabledWorkflows - Map of enabled workflows (path -> boolean)
	 * @returns Discovery result with all workflows
	 */
	async discoverWorkflows(cwd: string, enabledWorkflows?: Map<string, boolean>): Promise<WorkflowDiscoveryResult> {
		// Check cache first if enabled
		const cacheKey = this.getCacheKey(cwd)
		if (this.config.enableCache && this.cache.has(cacheKey)) {
			const cached = this.cache.get(cacheKey)!
			const now = Date.now()

			// Check if cache is still valid
			if (now - cached.timestamp < this.config.cacheTtlMs) {
				const workflows = this.applyEnabledStatus(cached.workflows, enabledWorkflows)
				return {
					workflows,
					globalCount: workflows.filter((w) => w.source === "global").length,
					workspaceCount: workflows.filter((w) => w.source === "workspace").length,
					fromCache: true,
				}
			}
		}

		// Discover workflows
		const workflows: DiscoveredWorkflow[] = []

		// Scan global workflows
		if (this.config.includeGlobal) {
			const globalDir = this.getGlobalWorkflowsDir()
			const globalWorkflows = await this.scanner.scanGlobalWorkflows(globalDir)
			workflows.push(...globalWorkflows)
		}

		// Scan workspace workflows
		if (this.config.includeWorkspace) {
			const workspaceDir = this.getWorkspaceWorkflowsDir(cwd)
			const workspaceWorkflows = await this.scanner.scanWorkspaceWorkflows(workspaceDir)
			workflows.push(...workspaceWorkflows)
		}

		// Apply enabled status from workflow toggles
		const workflowsWithStatus = this.applyEnabledStatus(workflows, enabledWorkflows)

		// Cache the result if enabled
		if (this.config.enableCache) {
			this.cache.set(cacheKey, {
				workflows: workflowsWithStatus,
				timestamp: Date.now(),
			})
		}

		return {
			workflows: workflowsWithStatus,
			globalCount: workflowsWithStatus.filter((w) => w.source === "global").length,
			workspaceCount: workflowsWithStatus.filter((w) => w.source === "workspace").length,
			fromCache: false,
		}
	}

	/**
	 * Get enabled workflows only
	 * @param cwd - Current working directory
	 * @param enabledWorkflows - Map of enabled workflows (path -> boolean)
	 * @returns Array of enabled workflows
	 */
	async getEnabledWorkflows(cwd: string, enabledWorkflows?: Map<string, boolean>): Promise<DiscoveredWorkflow[]> {
		const result = await this.discoverWorkflows(cwd, enabledWorkflows)
		return result.workflows.filter((w) => w.enabled)
	}

	/**
	 * Clear the cache
	 */
	clearCache(): void {
		this.cache.clear()
	}

	/**
	 * Clear cache for a specific directory
	 * @param cwd - Current working directory
	 */
	clearCacheForDir(cwd: string): void {
		const cacheKey = this.getCacheKey(cwd)
		this.cache.delete(cacheKey)
	}

	/**
	 * Update configuration
	 * @param config - Partial configuration to update
	 */
	updateConfig(config: Partial<WorkflowDiscoveryConfig>): void {
		this.config = { ...this.config, ...config }
	}

	/**
	 * Get current configuration
	 * @returns Current configuration
	 */
	getConfig(): WorkflowDiscoveryConfig {
		return { ...this.config }
	}

	/**
	 * Apply enabled status to workflows based on workflow toggles
	 * @param workflows - Array of workflows
	 * @param enabledWorkflows - Map of enabled workflows (path -> boolean)
	 * @returns Workflows with updated enabled status
	 */
	private applyEnabledStatus(
		workflows: DiscoveredWorkflow[],
		enabledWorkflows?: Map<string, boolean>,
	): DiscoveredWorkflow[] {
		if (!enabledWorkflows || enabledWorkflows.size === 0) {
			// If no toggles provided, all workflows are enabled by default
			return workflows.map((w) => ({ ...w, enabled: true }))
		}

		return workflows.map((workflow) => {
			// Check if workflow is in the enabled map
			const isEnabled = enabledWorkflows.get(workflow.filePath)
			return {
				...workflow,
				enabled: isEnabled !== false, // Default to true if not in map
			}
		})
	}

	/**
	 * Get cache key for a directory
	 * @param cwd - Current working directory
	 * @returns Cache key
	 */
	private getCacheKey(cwd: string): string {
		return cwd
	}

	/**
	 * Get global workflows directory path
	 * @returns Path to global workflows directory
	 */
	private getGlobalWorkflowsDir(): string {
		const homeDir = process.env.HOME || process.env.USERPROFILE || ""
		return path.join(homeDir, ".kilocode", "workflows")
	}

	/**
	 * Get workspace workflows directory path
	 * @param cwd - Current working directory
	 * @returns Path to workspace workflows directory
	 */
	private getWorkspaceWorkflowsDir(cwd: string): string {
		return path.join(cwd, ".kilocode", "workflows")
	}
}
