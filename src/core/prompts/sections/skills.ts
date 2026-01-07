import { SkillsManager, SkillMetadata } from "../../../services/skills/SkillsManager"

/**
 * Get a display-friendly relative path for a skill.
 * Converts absolute paths to relative paths to avoid leaking sensitive filesystem info.
 *
 * @param skill - The skill metadata
 * @returns A relative path like ".kilocode/skills/name/SKILL.md" or "~/.kilocode/skills/name/SKILL.md"
 */
function getDisplayPath(skill: SkillMetadata): string {
	const basePath = skill.source === "project" ? ".kilocode" : "~/.kilocode"
	const skillsDir = skill.mode ? `skills-${skill.mode}` : "skills"
	return `${basePath}/${skillsDir}/${skill.name}/SKILL.md`
}

/**
 * Generate the skills section for the system prompt.
 * Only includes skills relevant to the current mode.
 * Format matches the modes section style.
 *
 * @param skillsManager - The SkillsManager instance
 * @param currentMode - The current mode slug (e.g., 'code', 'architect')
 */
export async function getSkillsSection(
	skillsManager: SkillsManager | undefined,
	currentMode: string | undefined,
): Promise<string> {
	if (!skillsManager || !currentMode) return ""

	// Get skills filtered by current mode (with override resolution)
	const skills = skillsManager.getSkillsForMode(currentMode)
	if (skills.length === 0) return ""

	// Separate generic and mode-specific skills for display
	const genericSkills = skills.filter((s) => !s.mode)
	const modeSpecificSkills = skills.filter((s) => s.mode === currentMode)

	let skillsList = ""

	if (modeSpecificSkills.length > 0) {
		skillsList += modeSpecificSkills
			.map(
				(skill) =>
					`  * "${skill.name}" skill (${currentMode} mode) - ${skill.description} [${getDisplayPath(skill)}]`,
			)
			.join("\n")
	}

	if (genericSkills.length > 0) {
		if (skillsList) skillsList += "\n"
		skillsList += genericSkills
			.map((skill) => `  * "${skill.name}" skill - ${skill.description} [${getDisplayPath(skill)}]`)
			.join("\n")
	}

	return `====

AVAILABLE SKILLS

Skills are pre-packaged instructions for specific tasks. When a user request matches a skill description, read the full SKILL.md file to get detailed instructions.

- These are the currently available skills for "${currentMode}" mode:
${skillsList}

To use a skill:
1. Identify which skill matches the user's request based on the description
2. Use read_file to load the full SKILL.md file from the path shown in brackets
3. Follow the instructions in the skill file
4. Access any bundled files (scripts, references, assets) as needed
`
}
