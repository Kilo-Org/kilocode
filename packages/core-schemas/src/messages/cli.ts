import { z } from "zod"

/**
 * Welcome message options schema
 */
export const welcomeMessageOptionsSchema = z.object({
	// Clear viewport before showing the message
	clearScreen: z.boolean().optional(),
	// Display options
	showInstructions: z.boolean().optional(),
	// Content customization
	instructions: z.array(z.string()).optional(),
	// Parallel mode branch name
	worktreeBranch: z.string().optional(),
	// Workspace directory
	workspace: z.string().optional(),
})

/**
 * CLI message schema
 */
export const cliMessageSchema = z.object({
	id: z.string(),
	type: z.enum(["user", "assistant", "system", "error", "welcome", "empty", "requestCheckpointRestoreApproval"]),
	content: z.string(),
	ts: z.number(),
	partial: z.boolean().optional(),
	metadata: z
		.object({
			welcomeOptions: welcomeMessageOptionsSchema.optional(),
		})
		.optional(),
	payload: z.unknown().optional(),
})

/**
 * CLI options schema
 */
export const cliOptionsSchema = z.object({
	mode: z.string().optional(),
	workspace: z.string().optional(),
	ci: z.boolean().optional(),
	yolo: z.boolean().optional(),
	json: z.boolean().optional(),
	jsonInteractive: z.boolean().optional(),
	prompt: z.string().optional(),
	timeout: z.number().optional(),
	customModes: z.array(z.unknown()).optional(), // ModeConfig from @roo-code/types
	parallel: z.boolean().optional(),
	worktreeBranch: z.string().optional(),
	continue: z.boolean().optional(),
	provider: z.string().optional(),
	model: z.string().optional(),
	session: z.string().optional(),
	fork: z.string().optional(),
	noSplash: z.boolean().optional(),
	appendSystemPrompt: z.string().optional(),
})

// Inferred types
export type WelcomeMessageOptions = z.infer<typeof welcomeMessageOptionsSchema>
export type CliMessage = z.infer<typeof cliMessageSchema>
export type CLIOptions = z.infer<typeof cliOptionsSchema>
