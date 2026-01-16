// kilocode_change - new file
import { z } from "zod"

/**
 * Line change information with hash
 * Uses snake_case to match the API contract
 */
export interface LineChange {
	line_number: number
	line_hash: string
}

/**
 * Contribution payload sent to the attributions worker
 * Uses snake_case to match the API contract
 */
export interface ContributionPayload {
	project_id: string
	branch: string
	file_path: string
	lines_added: LineChange[]
	lines_removed: LineChange[]
	status: "accepted" | "rejected"
	task_id?: string
}

export type TokenProvisionResponse = z.infer<typeof TokenProvisionResponse>
/**
 * Zod schema for validating token provisioning response
 */
export const TokenProvisionResponse = z.object({
	token: z.string(),
	expiresAt: z.string(), // ISO 8601 date string
	organizationId: z.string(),
})

/**
 * Parameters for tracking a contribution
 */
export interface TrackContributionParams {
	cwd: string
	filePath: string
	/**
	 * The original file content before the AI's changes were applied.
	 * This is used to generate a diff against the formatted new content.
	 */
	originalContent: string
	/**
	 * The new file content after the AI's changes were applied.
	 * This content will be formatted using VSCode's formatters before hashing
	 * to ensure the fingerprints match what the user sees after format-on-save.
	 */
	newContent: string
	status: "accepted" | "rejected"
	taskId?: string
	organizationId?: string
	kilocodeToken: string
}
