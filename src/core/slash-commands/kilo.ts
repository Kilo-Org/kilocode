// kilocode_change whole file

import { ClineRulesToggles } from "../../shared/cline-rules"
import { SkillMetadata } from "../../shared/skills"
import fs from "fs/promises"
import path from "path"
import {
	newTaskToolResponse,
	newRuleToolResponse,
	reportBugToolResponse,
	condenseToolResponse,
} from "../prompts/commands"

function enabledWorkflowToggles(workflowToggles: ClineRulesToggles) {
	return Object.entries(workflowToggles)
		.filter(([_, enabled]) => enabled)
		.map(([filePath, _]) => ({
			fullPath: filePath,
			fileName: path.basename(filePath),
		}))
}

/**
 * This file is a duplicate of parseSlashCommands, but it adds a check for the newrule command
 * and processes Kilo-specific slash commands. It should be merged with parseSlashCommands in the future.
 */
export async function parseKiloSlashCommands(
	text: string,
	localWorkflowToggles: ClineRulesToggles,
	globalWorkflowToggles: ClineRulesToggles,
	skills: SkillMetadata[] = [],
): Promise<{ processedText: string; needsRulesFileCheck: boolean }> {
	const condenseAliases = condenseToolResponse

	const commandReplacements: Record<string, ((userInput: string) => string) | undefined> = {
		newtask: newTaskToolResponse,
		newrule: newRuleToolResponse,
		reportbug: reportBugToolResponse,
		smol: condenseAliases,
		condense: condenseAliases,
		compact: condenseAliases,
	}

	// this currently allows matching prepended whitespace prior to /slash-command
	const tagPattern = /<(task|feedback|answer|user_message)>(\s*\/([a-zA-Z0-9_.-]+))(\s+.+?)?\s*<\/\1>/dis

	const match = tagPattern.exec(text)

	if (match?.indices) {
		// remove the slash command
		const commandName = match[3]
		const [slashCommandStartIndex, slashCommandEndIndex] = match.indices[2]
		const textWithoutSlashCommand = text.slice(0, slashCommandStartIndex) + text.slice(slashCommandEndIndex)

		const command = commandReplacements[commandName]
		if (command) {
			const processedText = command(textWithoutSlashCommand)
			return { processedText, needsRulesFileCheck: commandName === "newrule" }
		}

		const matchingWorkflow = [
			...enabledWorkflowToggles(localWorkflowToggles),
			...enabledWorkflowToggles(globalWorkflowToggles),
		].find((workflow) => workflow.fileName === commandName)

		if (matchingWorkflow) {
			try {
				// Read workflow file content from the full path
				const workflowContent = (await fs.readFile(matchingWorkflow.fullPath, "utf8")).trim()

				const processedText =
					`<explicit_instructions type="${matchingWorkflow.fileName}">\n${workflowContent}\n</explicit_instructions>\n` +
					textWithoutSlashCommand

				return { processedText, needsRulesFileCheck: false }
			} catch (error) {
				console.error(`Error reading workflow file ${matchingWorkflow.fullPath}: ${error}`)
			}
		}

		// Check for matching skill
		const matchingSkill = skills.find((skill) => skill.name === commandName)
		if (matchingSkill) {
			try {
				const skillContent = (await fs.readFile(matchingSkill.path, "utf8")).trim()

				const processedText =
					`<explicit_instructions type="${matchingSkill.name}">\n${skillContent}\n</explicit_instructions>\n` +
					textWithoutSlashCommand

				return { processedText, needsRulesFileCheck: false }
			} catch (error) {
				console.error(`Error reading skill file ${matchingSkill.path}: ${error}`)
			}
		}
	}

	// if no supported commands are found, return the original text
	return { processedText: text, needsRulesFileCheck: false }
}
