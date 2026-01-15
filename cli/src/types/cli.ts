/**
 * CLI Types
 *
 * Re-exports types from @kilocode/core-schemas for runtime validation
 * and backward compatibility with existing code.
 */

import type { ModeConfig } from "@roo-code/types"

// Re-export schemas from core-schemas
export { welcomeMessageOptionsSchema, cliMessageSchema, cliOptionsSchema } from "@kilocode/core-schemas"

// Re-export schema-inferred types for simpler cases
export type { WelcomeMessageOptions, CliMessage } from "@kilocode/core-schemas"

// CLIOptions interface with proper typing for ModeConfig
// (The schema uses z.unknown() but we want proper types at compile time)
export interface CLIOptions {
	mode?: string
	workspace?: string
	ci?: boolean
	yolo?: boolean
	json?: boolean
	jsonInteractive?: boolean
	prompt?: string
	timeout?: number
	customModes?: ModeConfig[]
	parallel?: boolean
	worktreeBranch?: string | undefined
	continue?: boolean
	provider?: string
	model?: string
	session?: string
	fork?: string
	noSplash?: boolean
	appendSystemPrompt?: string
	attachments?: string[] | undefined
	onTaskCompleted?: string
}
