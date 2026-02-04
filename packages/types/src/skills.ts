/**
 * Skill metadata for discovery (loaded at startup)
 * Only name and description are required for now
 */
export interface SkillMetadata {
	name: string // Required: skill identifier
	description: string // Required: when to use this skill
	path: string // Absolute path to SKILL.md (or "<built-in:name>" for built-in skills)
	source: "global" | "project" | "built-in" // Where the skill was discovered
	/**
	 * @deprecated Use modeSlugs instead. Kept for backward compatibility.
	 * If set, skill is only available in this mode.
	 */
	mode?: string
	/**
	 * Mode slugs where this skill is available.
	 * - undefined or empty array means the skill is available in all modes ("Any mode").
	 * - An array with one or more mode slugs restricts the skill to those modes.
	 */
	modeSlugs?: string[]
}

/**
 * Skill name validation constants per agentskills.io specification:
 * https://agentskills.io/specification
 *
 * Name constraints:
 * - 1-64 characters
 * - Lowercase letters, numbers, and hyphens only
 * - Must not start or end with a hyphen
 * - Must not contain consecutive hyphens
 */
export const SKILL_NAME_MIN_LENGTH = 1
export const SKILL_NAME_MAX_LENGTH = 64

/**
 * Regex pattern for valid skill names.
 * Matches: lowercase letters/numbers, optionally followed by groups of hyphen + lowercase letters/numbers.
 * This ensures no leading/trailing hyphens and no consecutive hyphens.
 */
export const SKILL_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Error codes for skill name validation.
 * These can be mapped to translation keys in the frontend or error messages in the backend.
 */
export enum SkillNameValidationError {
	Empty = "empty",
	TooLong = "too_long",
	InvalidFormat = "invalid_format",
}

/**
 * Result of skill name validation.
 */
export interface SkillNameValidationResult {
	valid: boolean
	error?: SkillNameValidationError
}

/**
 * Validate a skill name according to agentskills.io specification.
 *
 * @param name - The skill name to validate
 * @returns Validation result with error code if invalid
 */
export function validateSkillName(name: string): SkillNameValidationResult {
	if (!name || name.length < SKILL_NAME_MIN_LENGTH) {
		return { valid: false, error: SkillNameValidationError.Empty }
	}

	if (name.length > SKILL_NAME_MAX_LENGTH) {
		return { valid: false, error: SkillNameValidationError.TooLong }
	}

	if (!SKILL_NAME_REGEX.test(name)) {
		return { valid: false, error: SkillNameValidationError.InvalidFormat }
	}

	return { valid: true }
}
