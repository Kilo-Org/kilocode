import { buildApiHandler } from "../../../api"
import { Task } from "../../task/Task"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../../shared/cost"
import { singleCompletionHandler, streamResponseFromHandler } from "../../../utils/single-completion-handler"
import { execSync } from "child_process"
import { existsSync } from "fs"
import { isAbsolute, join } from "path"
import { getApiProtocol } from "@roo-code/types"

/**
 * Evaluates whether an action should be approved using an AI gatekeeper model.
 * This is used in YOLO mode to provide a safety layer instead of blindly approving everything.
 *
 * @param cline - The task instance
 * @param toolName - The name of the tool being used
 * @param toolParams - The parameters for the tool
 * @returns Promise<boolean> - true if approved, false if denied, defaults to true on error
 */
export async function evaluateGatekeeperApproval(
	cline: Task,
	toolName: string,
	toolParams: Record<string, any>,
): Promise<boolean> {
	try {
		const state = await cline.providerRef.deref()?.getState()
		const gatekeeperConfigId = state?.yoloGatekeeperApiConfigId

		// If no gatekeeper is configured, default to approve (original YOLO behavior)
		if (!gatekeeperConfigId) {
			return true
		}

		// Get the gatekeeper API configuration
		const listApiConfigMeta = state?.listApiConfigMeta
		if (!listApiConfigMeta || !Array.isArray(listApiConfigMeta)) {
			console.warn("[Gatekeeper] No API configs available, defaulting to approve")
			return true
		}

		const gatekeeperConfig = listApiConfigMeta.find((config) => config.id === gatekeeperConfigId)
		if (!gatekeeperConfig) {
			console.warn("[Gatekeeper] Configured gatekeeper not found, defaulting to approve")
			return true
		}

		// Load the full profile settings
		const profile = await cline.providerRef.deref()?.providerSettingsManager.getProfile({
			id: gatekeeperConfigId,
		})

		if (!profile || !profile.apiProvider) {
			console.warn("[Gatekeeper] Could not load gatekeeper profile, defaulting to approve")
			return true
		}

		// Build the approval prompt using the task's workspace directory
		const { systemPrompt, userPrompt, preApproved } = buildGatekeeperPrompt(toolName, toolParams, cline.cwd)

		if (preApproved) {
			console.log(`[Gatekeeper] Tool: ${toolName}, Decision: PRE-APPROVED`)

			return true
		}

		const handler = buildApiHandler(profile)

		// Initialize handler if it has an initialize method
		if ("initialize" in handler && typeof handler.initialize === "function") {
			await handler.initialize()
		}

		const { text, usage } = await streamResponseFromHandler(handler, userPrompt, systemPrompt)

		// Parse the response - look for "yes", "approve", "allowed" vs "no", "deny", "block"
		const normalizedResponse = text.toLowerCase().trim()
		const approved =
			normalizedResponse.startsWith("yes") ||
			normalizedResponse.startsWith("approve") ||
			normalizedResponse.startsWith("allow")

		console.log(`[Gatekeeper] Tool: ${toolName}, Decision: ${approved ? "APPROVED" : "DENIED"}`)

		// Display cost if usage information is available
		if (usage) {
			// Use totalCost if provided (e.g., from OpenRouter), otherwise calculate it
			let cost = usage.totalCost

			// If totalCost is not provided, calculate it using model info
			if (cost === undefined) {
				const model = handler.getModel()
				const modelInfo = model.info

				// Determine which cost calculation function to use based on the provider's API protocol
				const apiProtocol = getApiProtocol(profile.apiProvider, model.id)

				if (apiProtocol === "anthropic") {
					cost = calculateApiCostAnthropic(
						modelInfo,
						usage.inputTokens,
						usage.outputTokens,
						usage.cacheWriteTokens,
						usage.cacheReadTokens,
					).totalCost
				} else {
					cost = calculateApiCostOpenAI(
						modelInfo,
						usage.inputTokens,
						usage.outputTokens,
						usage.cacheWriteTokens,
						usage.cacheReadTokens,
					).totalCost
				}
			}

			let formattedCost: string
			if (cost < 0.0001) {
				formattedCost = "<$0.0001"
			} else {
				// Format with up to 4 decimal places, removing trailing zeroes
				formattedCost = `$${cost.toFixed(4).replace(/\.?0+$/, "")}`
			}

			await cline.say(
				"text",
				`🛡️ Gatekeeper ${approved ? "✅ approved" : "❌ denied"} **${toolName}** (${formattedCost})`,
				undefined,
				false,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
		}

		return approved
	} catch (error) {
		// On any error, default to approve to avoid blocking the workflow
		console.error("[Gatekeeper] Error evaluating approval, defaulting to approve:", error)
		return true
	}
}

/**
 * Checks if the current workspace is within a git repository
 * Uses git command to properly detect repos even in subdirectories
 * @returns The git repository root directory path, or empty string if not in a git repo
 */
function getGitRepository(workspaceDir: string): string {
	try {
		const result = execSync("git rev-parse --show-toplevel", {
			cwd: workspaceDir,
			stdio: "pipe",
			timeout: 1000,
		})
		return result.toString().trim()
	} catch {
		return ""
	}
}

/**
 * Checks if a file is tracked by git
 * @param filePath - The path to the file relative to workspace
 * @param workspaceDir - The workspace directory
 * @returns true if file is tracked, false otherwise
 */
function isFileTrackedByGit(filePath: string, workspaceDir: string): boolean {
	try {
		// Use git ls-files to check if file is tracked
		// This command returns the file path if tracked, empty if not
		const result = execSync(`git ls-files --error-unmatch "${filePath}"`, {
			cwd: workspaceDir,
			stdio: "pipe",
			timeout: 1000,
		})
		return result.toString().trim().length > 0
	} catch {
		// File is not tracked or git command failed
		return false
	}
}

/**
 * Extracts file/directory paths from a command string
 * @param command - The command string to parse
 * @param workspaceDir - The workspace directory to check paths against
 * @returns Array of file/directory paths found in the command
 */
function extractFilePathsFromCommand(command: string, workspaceDir: string): string[] {
	// Split by space and remove leading/trailing quotes
	const parts = command.split(" ").map((part) => part.replace(/^["']|["']$/g, ""))

	const filePaths: string[] = []
	for (const part of parts) {
		if (!part) continue

		// Skip flags (starting with -)
		if (part.startsWith("-")) continue

		// Heuristic: Skip tokens that look like commands rather than file paths
		// Commands typically:
		// - Have no path separators (/, \)
		// - Don't start with . (relative paths)
		// - Don't have file extensions
		// - Are short (< 20 chars typically)
		const hasPathSeparator = part.includes("/") || part.includes("\\")
		const startsWithDot = part.startsWith(".")
		const hasExtension = part.includes(".") && !part.startsWith(".")
		const isShort = part.length < 20

		// If it looks like a command (no path indicators, short, no extension), skip it
		if (!hasPathSeparator && !startsWithDot && !hasExtension && isShort) {
			continue
		}

		try {
			// Resolve path relative to workspace
			const resolvedPath = isAbsolute(part) ? part : join(workspaceDir, part)

			// Check if it's a file or directory
			if (existsSync(resolvedPath)) {
				filePaths.push(part)
			}
		} catch {
			// Skip if path resolution fails
			continue
		}
	}

	return filePaths
}

/**
 * Builds a concise prompt for the gatekeeper model to evaluate an action.
 *
 * @param toolName - The name of the tool being used
 * @param toolParams - The parameters for the tool
 * @returns Object with systemPrompt and userPrompt
 */
function buildGatekeeperPrompt(
	toolName: string,
	toolParams: Record<string, any>,
	workspaceDir: string,
): { systemPrompt: string; userPrompt: string; preApproved: boolean } {
	const gitRepoPath = getGitRepository(workspaceDir)
	const isGitRepo = !!gitRepoPath

	// Build a concise description of the action
	let actionDescription = `Tool: ${toolName}\n`

	// Add key parameters based on tool type
	switch (toolName) {
		case "write_to_file":
		case "apply_diff":
		case "search_and_replace":
		case "fast_edit_file":
		case "edit_file": {
			const filePath = toolParams.path || toolParams.target_file || "unknown"
			actionDescription += `File: ${filePath}\n`

			if (toolParams.content) {
				const contentPreview = toolParams.content.substring(0, 200)
				actionDescription += `Content preview: ${contentPreview}${toolParams.content.length > 200 ? "..." : ""}\n`
			}
			break
		}
		case "execute_command": {
			const command = toolParams.command || "unknown"
			actionDescription += `Command: ${command}\n`
			if (toolParams.cwd) {
				actionDescription += `Working directory: ${toolParams.cwd}\n`
			}

			if (isGitRepo) {
				// Extract file paths from the command
				const filePaths = extractFilePathsFromCommand(command, workspaceDir)

				// Check git tracking status for each file found
				for (const filePath of filePaths) {
					const isTracked = isFileTrackedByGit(filePath, workspaceDir)
					actionDescription += `Target file "${filePath}" git tracked: ${isTracked ? "YES (recoverable)" : "NO (untracked)"}\n`
				}
			}
			break
		}
		case "update_todo_list":
		case "list_code_definition_names":
		case "list_files":
		case "search_files":
		case "codebase_search":
		case "read_file": {
			return { preApproved: true, systemPrompt: "", userPrompt: "" }
		}
		case "browser_action":
			actionDescription += `Action: ${toolParams.action}\n`
			if (toolParams.url) actionDescription += `URL: ${toolParams.url}\n`
			break
		case "use_mcp_tool":
			actionDescription += `Server: ${toolParams.server_name}\n`
			actionDescription += `Tool: ${toolParams.tool_name}\n`
			break
		default: {
			// For other tools, include all params (truncated)
			const paramsStr = JSON.stringify(toolParams, null, 2).substring(0, 300)
			actionDescription += `Parameters: ${paramsStr}${JSON.stringify(toolParams).length > 300 ? "..." : ""}\n`
		}
	}

	console.log("[Gatekeeper] Action Description:", actionDescription)

	const systemPrompt = `You are a safety gatekeeper for an AI coding assistant. Evaluate whether actions should be allowed.

WORKSPACE CONTEXT:
- Workspace directory: ${workspaceDir}
- Git repository: ${isGitRepo ? "YES (" + gitRepoPath + ") - files can be recovered via git" : "NO (deletions are permanent)"}
- All file operations are relative to this workspace
- The assistant needs to read, write, and modify files within the workspace to function

CORE PRINCIPLES:

1. READ OPERATIONS ARE SAFE
	- Reading files, listing directories, searching code
	- Viewing git history, diffs, logs
	- These cannot cause harm

2. TASK MANAGEMENT OPERATIONS ARE SAFE
	- update_todo_list: Always safe, just tracks task progress
	- These are internal state management, not file operations

3. WRITE OPERATIONS WITHIN WORKSPACE ARE GENERALLY SAFE
	- Creating, editing, modifying files in workspace
	- The user expects the assistant to make changes
	- Exception: Be cautious with critical config files (.git/config, etc.)

4. DELETION DEPENDS ON RECOVERABILITY
	- In git repos: Tracked files can be recovered via git → ALLOW
	- Without git: Deletions are permanent → DANGEROUS
  - Temporary/test files: Always safe to delete
	- Multiple files or recursive deletion: HIGH RISK (evaluate carefully)

5. COMMANDS SHOULD BE EVALUATED BY INTENT AND SCOPE
	- Read-only commands (ls, cat, grep, git status): SAFE
	- Build/test commands (npm test, pytest): SAFE
	- Commands with destructive potential: Evaluate carefully
	- Look for patterns indicating bulk operations, recursion, or system-wide changes
	- Any command touching system directories (/etc, /usr, /bin): DENY

6. MCP TOOLS REQUIRE CONTEXT EVALUATION
	- Read-only operations (search, fetch, get): Generally SAFE
	- Write operations (create, update, delete): Evaluate based on scope
	- External API calls: Consider what data is being sent/modified
	- File system operations: Apply same rules as direct file operations
	- Example: GitHub MCP reading repos is safe, but deleting repos is dangerous

7. SYSTEM INTEGRITY IS PARAMOUNT
	- No sudo or privilege escalation
	- No modifications to system directories
	- No global package installations that affect system
	- No exposing services to public networks
	- No operations outside workspace without clear justification

EVALUATION APPROACH:
- Ask: "What is the worst-case outcome of this action?"
- Ask: "Can this be undone or recovered?"
- Ask: "Is this within the expected scope of a coding assistant?"
- Ask: "Does this affect only the workspace or broader system?"

EXAMPLES OF GOOD DECISIONS:
✓ Approve: Editing workspace files, creating new files, editing new files
✓ Approve: Running tests, building projects, starting dev servers
✓ Approve: Git operations that don't lose data (add, commit, status, log)
✓ Approve: Deleting temp/test files, even without git
✓ Approve: Deleting tracked files in git repos (recoverable via git)
✓ Approve: MCP tools for reading documentation, searching GitHub
✗ Deny: Recursive deletion (rm -rf, find -delete, etc.)
✗ Deny: Deleting untracked files without git safety net
✗ Deny: Commands with sudo or system modifications
✗ Deny: Operations outside workspace
✗ Deny: MCP tools that delete external resources (repos, databases, etc.)
✗ Deny: Commands that could cause data loss

Respond with ONLY "yes" to approve or "no" to deny. Be concise.`

	const userPrompt = `Evaluate this action:

${actionDescription}`

	return { systemPrompt, userPrompt, preApproved: false }
}
