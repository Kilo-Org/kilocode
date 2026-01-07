// kilocode_change whole file

import { ClineRulesToggles } from "../../shared/cline-rules"
import fs from "fs/promises"
import path from "path"
import {
	newTaskToolResponse,
	newRuleToolResponse,
	reportBugToolResponse,
	condenseToolResponse,
	reviewToolResponse,
} from "../prompts/commands"
import { ReviewService, buildReviewPrompt } from "../../services/review"

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
	cwd?: string,
): Promise<{ processedText: string; needsRulesFileCheck: boolean }> {
	const commandReplacements: Record<string, ((userInput: string) => string) | undefined> = {
		newtask: newTaskToolResponse,
		newrule: newRuleToolResponse,
		reportbug: reportBugToolResponse,
		smol: condenseToolResponse,
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

		// Handle /review command - requires cwd for git operations
		if (commandName === "review") {
			if (!cwd) {
				// Fallback when cwd is not available
				const processedText = reviewToolResponse(textWithoutSlashCommand)
				return { processedText, needsRulesFileCheck: false }
			}

			try {
				const reviewService = new ReviewService(cwd)
				const reviewContext = await reviewService.getReviewContext()

				if (reviewContext.scope === "none") {
					// No changes to review - return informative message
					const errorMessage = reviewContext.error || "No changes to review."
					const processedText = `<explicit_instructions type="review_info">
${errorMessage}

To use the /review command:
- Make some changes to your code (uncommitted changes will be reviewed)
- Or switch to a feature branch that has commits different from the base branch

If you want to review specific files, you can ask me to read and review them directly.
</explicit_instructions>
` + textWithoutSlashCommand
					return { processedText, needsRulesFileCheck: false }
				}

				const userInput = textWithoutSlashCommand.replace(/<[^>]+>/g, "").trim()
				const processedText = buildReviewPrompt(reviewContext, userInput)
				return { processedText, needsRulesFileCheck: false }
			} catch (error) {
				// Fallback to manual review prompt on error
				console.error(`Error in /review command: ${error}`)
				const processedText = reviewToolResponse(textWithoutSlashCommand)
				return { processedText, needsRulesFileCheck: false }
			}
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
	}

	// if no supported commands are found, return the original text
	return { processedText: text, needsRulesFileCheck: false }
}
