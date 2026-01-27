// kilocode_change - new file

/**
 * Review Service Module
 *
 * Provides lightweight local code review capabilities using git.
 * The agent dynamically explores changes using tools rather than
 * receiving pre-generated diff content.
 */

// Types
export type {
	ReviewScope,
	FileStatus,
	FileSummary,
	ReviewSummary,
	ReviewServiceOptions,
	ReviewScopeInfo,
} from "./types"

// Service
export { ReviewService } from "./ReviewService"

// Prompts
export { buildReviewPrompt } from "./prompts"
