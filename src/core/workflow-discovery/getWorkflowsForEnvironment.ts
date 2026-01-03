// kilocode_change - new file

import type { DiscoveredWorkflow } from "./types"
import { WorkflowDiscoveryService } from "./WorkflowDiscoveryService"
import { EXPERIMENT_IDS, experiments as Experiments } from "../../shared/experiments"

/**
 * Singleton instance of workflow discovery service
 */
let workflowDiscoveryService: WorkflowDiscoveryService | null = null

/**
 * Get or create workflow discovery service instance
 * @returns Workflow discovery service instance
 */
function getWorkflowDiscoveryService(): WorkflowDiscoveryService {
	if (!workflowDiscoveryService) {
		workflowDiscoveryService = new WorkflowDiscoveryService({
			enableCache: true,
			cacheTtlMs: 5 * 60 * 1000, // 5 minutes
		})
	}
	return workflowDiscoveryService
}

/**
 * Format discovered workflows for environment details
 * @param workflows - Array of discovered workflows
 * @returns Formatted string for environment details
 */
function formatWorkflowsForEnvironment(workflows: DiscoveredWorkflow[]): string {
	if (workflows.length === 0) {
		return "(No workflows available)"
	}

	const lines: string[] = []

	// Group by source
	const globalWorkflows = workflows.filter((w) => w.source === "global" && w.enabled)
	const workspaceWorkflows = workflows.filter((w) => w.source === "workspace" && w.enabled)

	if (globalWorkflows.length > 0) {
		lines.push("## Global Workflows")
		for (const workflow of globalWorkflows) {
			const line = `- \`${workflow.commandName}\``
			if (workflow.description) {
				lines.push(`${line}: ${workflow.description}`)
			} else {
				lines.push(line)
			}
		}
	}

	if (workspaceWorkflows.length > 0) {
		if (globalWorkflows.length > 0) {
			lines.push("") // Empty line between sections
		}
		lines.push("## Workspace Workflows")
		for (const workflow of workspaceWorkflows) {
			const line = `- \`${workflow.commandName}\``
			if (workflow.description) {
				lines.push(`${line}: ${workflow.description}`)
			} else {
				lines.push(line)
			}
		}
	}

	return lines.join("\n")
}

/**
 * Get workflow information for environment details
 * This function is called by getEnvironmentDetails to add workflow information
 * when the workflow discovery experiment is enabled.
 *
 * @param cwd - Current working directory
 * @param experiments - Experiments configuration
 * @param enabledWorkflows - Map of enabled workflows (path -> boolean)
 * @returns Formatted workflow information string, or empty string if experiment is disabled
 */
export async function getWorkflowsForEnvironment(
	cwd: string,
	experiments: Record<string, boolean> = {},
	enabledWorkflows?: Map<string, boolean>,
): Promise<string> {
	// kilocode_change: Use Experiments.isEnabled to properly check experiment status with fallback to defaults
	// Check if workflow discovery experiment is enabled // kilocode_change
	if (!Experiments.isEnabled(experiments, EXPERIMENT_IDS.AUTO_EXECUTE_WORKFLOW)) {
		return ""
	}

	try {
		const service = getWorkflowDiscoveryService()
		const result = await service.discoverWorkflows(cwd, enabledWorkflows)

		// Only include enabled workflows
		const enabledWorkflowsList = result.workflows.filter((w) => w.enabled)

		if (enabledWorkflowsList.length === 0) {
			return ""
		}

		const formatted = formatWorkflowsForEnvironment(enabledWorkflowsList)
		return `\n\n# Available Workflows\n${formatted}`
	} catch (error) {
		// Log error but don't break environment details generation
		console.warn("[WorkflowDiscovery] Failed to discover workflows for environment details:", error)
		return ""
	}
}

/**
 * Clear workflow discovery cache
 * This should be called when workflow files are added/removed/modified
 */
export function clearWorkflowDiscoveryCache(): void {
	if (workflowDiscoveryService) {
		workflowDiscoveryService.clearCache()
	}
}

/**
 * Clear workflow discovery cache for a specific directory
 * @param cwd - Current working directory
 */
export function clearWorkflowDiscoveryCacheForDir(cwd: string): void {
	if (workflowDiscoveryService) {
		workflowDiscoveryService.clearCacheForDir(cwd)
	}
}
