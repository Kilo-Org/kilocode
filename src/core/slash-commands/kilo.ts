// kilocode_change whole file

import { ClineRulesToggles } from "../../shared/cline-rules"
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
): Promise<{ processedText: string; needsRulesFileCheck: boolean }> {
	const commandReplacements: Record<string, ((userInput: string) => string) | undefined> = {
		newtask: newTaskToolResponse,
		newrule: newRuleToolResponse,
		reportbug: reportBugToolResponse,
		smol: condenseToolResponse,
	}

	// this currently allows matching prepended whitespace prior to /slash-command
	const tagPatterns = [
		{ tag: "task", regex: /<task>(\s*\/([a-zA-Z0-9_.-]+))(\s+.+?)?\s*<\/task>/is },
		{ tag: "feedback", regex: /<feedback>(\s*\/([a-zA-Z0-9_.-]+))(\s+.+?)?\s*<\/feedback>/is },
		{ tag: "answer", regex: /<answer>(\s*\/([a-zA-Z0-9_.-]+))(\s+.+?)?\s*<\/answer>/is },
		{ tag: "user_message", regex: /<user_message>(\s*\/([a-zA-Z0-9_.-]+))(\s+.+?)?\s*<\/user_message>/is },
	]

	// if we find a valid match, we will return inside that block
	for (const { regex } of tagPatterns) {
		const regexObj = new RegExp(regex.source, regex.flags)
		const match = regexObj.exec(text)

		if (match) {
			// match[1] is the command with any leading whitespace (e.g. " /newtask")
			// match[2] is just the command name (e.g. "newtask")

			const commandName = match[2] // casing matters
			const command = commandReplacements[commandName]

			if (command) {
				const fullMatchStartIndex = match.index

				// find position of slash command within the full match
				const fullMatch = match[0]
				const relativeStartIndex = fullMatch.indexOf(match[1])

				// calculate absolute indices in the original string
				const slashCommandStartIndex = fullMatchStartIndex + relativeStartIndex
				const slashCommandEndIndex = slashCommandStartIndex + match[1].length

				// remove the slash command and add custom instructions at the top of this message
				const textWithoutSlashCommand =
					text.substring(0, slashCommandStartIndex) + text.substring(slashCommandEndIndex)
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

					// find position of slash command within the full match
					const fullMatchStartIndex = match.index
					const fullMatch = match[0]
					const relativeStartIndex = fullMatch.indexOf(match[1])

					// calculate absolute indices in the original string
					const slashCommandStartIndex = fullMatchStartIndex + relativeStartIndex
					const slashCommandEndIndex = slashCommandStartIndex + match[1].length

					// remove the slash command and add custom instructions at the top of this message
					const textWithoutSlashCommand =
						text.substring(0, slashCommandStartIndex) + text.substring(slashCommandEndIndex)
					const processedText =
						`<explicit_instructions type="${matchingWorkflow.fileName}">\n${workflowContent}\n</explicit_instructions>\n` +
						textWithoutSlashCommand

					return { processedText, needsRulesFileCheck: false }
				} catch (error) {
					console.error(`Error reading workflow file ${matchingWorkflow.fullPath}: ${error}`)
				}
			}
		}
	}

	// if no supported commands are found, return the original text
	return { processedText: text, needsRulesFileCheck: false }
}
