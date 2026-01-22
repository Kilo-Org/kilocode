import { z } from "zod"

/**
 * Agent Manager Types
 *
 * These types are used by the agent-manager in the extension for managing
 * CLI sessions and parallel mode worktrees.
 */

/**
 * Agent status schema
 */
export const agentStatusSchema = z.enum(["creating", "running", "done", "error", "stopped"])

/**
 * Session source schema
 */
export const sessionSourceSchema = z.enum(["local", "remote"])

/**
 * Parallel mode (worktree) information schema
 */
export const parallelModeInfoSchema = z.object({
	enabled: z.boolean(),
	branch: z.string().optional(), // e.g., "add-authentication-1702734891234"
	worktreePath: z.string().optional(), // e.g., ".kilocode/worktrees/add-auth..."
	parentBranch: z.string().optional(), // e.g., "main" - the branch worktree was created from
	completionMessage: z.string().optional(), // Merge instructions from CLI on completion
})

/**
 * Agent session schema
 */
export const agentSessionSchema = z.object({
	sessionId: z.string(),
	label: z.string(),
	prompt: z.string(),
	status: agentStatusSchema,
	startTime: z.number(),
	endTime: z.number().optional(),
	exitCode: z.number().optional(),
	error: z.string().optional(),
	logs: z.array(z.string()),
	pid: z.number().optional(),
	source: sessionSourceSchema,
	parallelMode: parallelModeInfoSchema.optional(),
	gitUrl: z.string().optional(),
	model: z.string().optional(), // Model ID used for this session
	mode: z.string().optional(), // Mode slug used for this session (e.g., "code", "architect")
})

/**
 * Pending session schema (waiting for CLI's session_created event)
 */
export const pendingSessionSchema = z.object({
	prompt: z.string(),
	label: z.string(),
	startTime: z.number(),
	parallelMode: z.boolean().optional(),
	gitUrl: z.string().optional(),
})

/**
 * Agent manager state schema
 */
export const agentManagerStateSchema = z.object({
	sessions: z.array(agentSessionSchema),
	selectedId: z.string().nullable(),
})

/**
 * Messages from Webview to Extension
 */
/**
 * Start session message schema - used for runtime validation of webview messages
 */
export const startSessionMessageSchema = z.object({
	type: z.literal("agentManager.startSession"),
	prompt: z.string(),
	parallelMode: z.boolean().optional(),
	existingBranch: z.string().optional(),
	model: z.string().optional(), // Model ID to use for this session
	mode: z.string().optional(), // Mode slug (e.g., "code", "architect")
	versions: z.number().optional(), // Number of versions for multi-version mode
	labels: z.array(z.string()).optional(), // Labels for multi-version sessions
	images: z.array(z.string()).optional(), // Image data URLs to include with the prompt
})

export const agentManagerMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("agentManager.webviewReady") }),
	startSessionMessageSchema,
	z.object({ type: z.literal("agentManager.stopSession"), sessionId: z.string() }),
	z.object({ type: z.literal("agentManager.selectSession"), sessionId: z.string() }),
	z.object({ type: z.literal("agentManager.refreshRemoteSessions") }),
	z.object({ type: z.literal("agentManager.listBranches") }),
	z.object({ type: z.literal("agentManager.refreshModels") }),
	z.object({ type: z.literal("agentManager.setMode"), sessionId: z.string(), mode: z.string() }),
])

/**
 * Remote session schema (simplified - full type comes from shared session client)
 */
export const remoteSessionSchema = z
	.object({
		id: z.string(),
		name: z.string().optional(),
		status: z.string().optional(),
	})
	.passthrough() // Allow additional fields from the full RemoteSession type

/**
 * Available model schema (from CLI models command)
 */
export const availableModelSchema = z.object({
	id: z.string(),
	displayName: z.string().nullable(),
	contextWindow: z.number(),
	supportsImages: z.boolean().optional(),
	inputPrice: z.number().optional(),
	outputPrice: z.number().optional(),
})

/**
 * Available mode schema (for mode selection)
 */
export const availableModeSchema = z.object({
	slug: z.string(),
	name: z.string(),
	description: z.string().optional(),
	iconName: z.string().optional(),
	source: z.enum(["global", "project", "organization"]).optional(),
})

/**
 * Messages from Extension to Webview
 */
export const agentManagerExtensionMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("agentManager.state"), state: agentManagerStateSchema }),
	z.object({ type: z.literal("agentManager.sessionUpdated"), session: agentSessionSchema }),
	z.object({ type: z.literal("agentManager.sessionRemoved"), sessionId: z.string() }),
	z.object({ type: z.literal("agentManager.error"), error: z.string() }),
	z.object({ type: z.literal("agentManager.remoteSessions"), sessions: z.array(remoteSessionSchema) }),
	z.object({
		type: z.literal("agentManager.branches"),
		branches: z.array(z.string()),
		currentBranch: z.string().optional(),
	}),
	z.object({
		type: z.literal("agentManager.availableModels"),
		provider: z.string(),
		currentModel: z.string(),
		models: z.array(availableModelSchema),
	}),
	z.object({
		type: z.literal("agentManager.modelsLoadFailed"),
		error: z.string().optional(),
	}),
	z.object({
		type: z.literal("agentManager.availableModes"),
		modes: z.array(availableModeSchema),
		currentMode: z.string(),
	}),
	z.object({
		type: z.literal("agentManager.modeChanged"),
		sessionId: z.string(),
		mode: z.string(),
		previousMode: z.string().optional(),
	}),
])

// Inferred types
export type AgentStatus = z.infer<typeof agentStatusSchema>
export type SessionSource = z.infer<typeof sessionSourceSchema>
export type AvailableModel = z.infer<typeof availableModelSchema>
export type AvailableMode = z.infer<typeof availableModeSchema>
export type ParallelModeInfo = z.infer<typeof parallelModeInfoSchema>
export type AgentSession = z.infer<typeof agentSessionSchema>
export type PendingSession = z.infer<typeof pendingSessionSchema>
export type AgentManagerState = z.infer<typeof agentManagerStateSchema>
export type AgentManagerMessage = z.infer<typeof agentManagerMessageSchema>
export type AgentManagerExtensionMessage = z.infer<typeof agentManagerExtensionMessageSchema>
export type StartSessionMessage = z.infer<typeof startSessionMessageSchema>
