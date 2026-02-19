// kilocode_change - new file

/**
 * Workflows service - manages workflows from .kilocode/workflows/ directories.
 * Unlike commands, workflows have no built-in variants.
 */

import * as path from "path"
import { MarkdownResource, scanResourceDirectory, tryLoadResource } from "../markdown-resource-base"

// Type alias for clarity
export type Workflow = MarkdownResource

/**
 * Get the global Kilo Code directory path
 */
function getGlobalKiloCodeDirectory(): string {
	const homeDir = process.env.HOME || process.env.USERPROFILE || ""
	return path.join(homeDir, ".kilocode")
}

/**
 * Get the project-level Kilo Code directory path
 */
function getProjectKiloCodeDirectoryForCwd(cwd: string): string {
	return path.join(cwd, ".kilocode")
}

/**
 * Get all available workflows (global + project)
 * Priority: project > global
 */
export async function getWorkflows(cwd: string): Promise<Workflow[]> {
	const workflows = new Map<string, Workflow>()

	// Scan global workflows first (lower priority)
	const globalDir = path.join(getGlobalKiloCodeDirectory(), "workflows")
	await scanResourceDirectory(globalDir, "global", workflows)

	// Scan project workflows (higher priority - override global)
	const projectDir = path.join(getProjectKiloCodeDirectoryForCwd(cwd), "workflows")
	await scanResourceDirectory(projectDir, "project", workflows)

	return Array.from(workflows.values())
}

/**
 * Get a specific workflow by name (optimized lookup)
 * Priority: project > global
 */
export async function getWorkflow(cwd: string, name: string): Promise<Workflow | undefined> {
	// Try project first (highest priority)
	const projectDir = path.join(getProjectKiloCodeDirectoryForCwd(cwd), "workflows")
	const projectWorkflow = await tryLoadResource(projectDir, name, "project")
	if (projectWorkflow) return projectWorkflow

	// Try global
	const globalDir = path.join(getGlobalKiloCodeDirectory(), "workflows")
	return await tryLoadResource(globalDir, name, "global")
}

/**
 * Get workflow names for autocomplete
 */
export async function getWorkflowNames(cwd: string): Promise<string[]> {
	const workflows = await getWorkflows(cwd)
	return workflows.map((wf) => wf.name)
}
