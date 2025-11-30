import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../../shared/tools"
import { Task } from "../../task/Task"
import { checkpointSave } from "../../checkpoints"
import { createAndOpenGitHubIssue } from "../../../utils/github-url-utils"
import { formatResponse } from "../../prompts/responses"
import * as vscode from "vscode"
import * as os from "os"

export async function reportBugTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const title = block.params.title
	const description = block.params.description

	try {
		if (block.partial) {
			await cline
				.ask(
					"report_bug",
					JSON.stringify({
						title: removeClosingTag("title", title),
						description: removeClosingTag("description", description),
					}),
					block.partial,
				)
				.catch(() => {})
			return
		} else {
			if (!title) {
				cline.consecutiveMistakeCount++
				pushToolResult(await cline.sayAndCreateMissingParamError("report_bug", "title"))
				await checkpointSave(cline)
				return
			}
			if (!description) {
				cline.consecutiveMistakeCount++
				pushToolResult(await cline.sayAndCreateMissingParamError("report_bug", "description"))
				await checkpointSave(cline)
				return
			}

			cline.consecutiveMistakeCount = 0

			// Derive system information values algorithmically
			const operatingSystem = os.platform() + " " + os.release()
			const kilocodeVersion =
				vscode.extensions.getExtension("kilocode.kilo-code")?.packageJSON.version || "Unknown"
			const systemInfo = `VSCode: ${vscode.version}, Node.js: ${process.version}, Architecture: ${os.arch()}`
			const providerAndModel = `${(await cline.providerRef.deref()?.contextProxy.getGlobalState("apiProvider")) as string} / ${cline.api.getModel().id}`

			// Ask user for confirmation
			const bugReportData = JSON.stringify({
				title,
				description,
				// Include derived values in the JSON for display purposes
				provider_and_model: providerAndModel,
				operating_system: operatingSystem,
				system_info: systemInfo,
				kilocode_version: kilocodeVersion,
			})

			const { text, images } = await cline.ask("report_bug", bugReportData, false)

			// If the user provided a response, treat it as feedback
			if (text || images?.length) {
				await cline.say("user_feedback", text ?? "", images)
				pushToolResult(
					formatResponse.toolResult(
						`The user provided feedback on the Github issue generated:\n<feedback>\n${text}\n</feedback>`,
						images,
					),
				)
			} else {
				// If no response, the user accepted the condensed version
				pushToolResult(formatResponse.toolResult(`The user accepted the creation of the Github issue.`))

				try {
					// Create a Map of parameters for the GitHub issue
					const params = new Map<string, string>()
					params.set("title", title)
					params.set(
						"description",
						`${description}\n\n**System Information:**\n- Provider & Model: ${providerAndModel}\n- Operating System: ${operatingSystem}\n- Kilo Code Version: ${kilocodeVersion}\n- ${systemInfo}`,
					)

					// Use our utility function to create and open the GitHub issue URL
					// This bypasses VS Code's URI handling issues with special characters
					await createAndOpenGitHubIssue("Kilo-Org", "kilocode", "bug_report.yml", params)
				} catch (error) {
					console.error(`An error occurred while attempting to report the bug: ${error}`)
				}
			}
			await checkpointSave(cline)
			return
		}
	} catch (error) {
		await handleError("reporting bug", error)
		await checkpointSave(cline)
		return
	}
}
