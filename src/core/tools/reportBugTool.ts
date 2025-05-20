import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { Task } from "../task/Task"

export async function reportBugTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const title = block.params.title
	const what_happened = block.params.what_happened
	const steps_to_reproduce = block.params.steps_to_reproduce
	const api_request_output = block.params.api_request_output
	const additional_context = block.params.additional_context

	try {
		if (block.partial) {
			await this.ask(
				"report_bug",
				JSON.stringify({
					title: removeClosingTag("title", title),
					what_happened: removeClosingTag("what_happened", what_happened),
					steps_to_reproduce: removeClosingTag("steps_to_reproduce", steps_to_reproduce),
					api_request_output: removeClosingTag("api_request_output", api_request_output),
					additional_context: removeClosingTag("additional_context", additional_context),
				}),
				block.partial,
			).catch(() => {})
			break
		} else {
			if (!title) {
				this.consecutiveMistakeCount++
				pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "title"))
				await this.saveCheckpoint()
				break
			}
			if (!what_happened) {
				this.consecutiveMistakeCount++
				pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "what_happened"))
				await this.saveCheckpoint()
				break
			}
			if (!steps_to_reproduce) {
				this.consecutiveMistakeCount++
				pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "steps_to_reproduce"))
				await this.saveCheckpoint()
				break
			}
			if (!api_request_output) {
				this.consecutiveMistakeCount++
				pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "api_request_output"))
				await this.saveCheckpoint()
				break
			}
			if (!additional_context) {
				this.consecutiveMistakeCount++
				pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "additional_context"))
				await this.saveCheckpoint()
				break
			}

			this.consecutiveMistakeCount = 0

			if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
				showSystemNotification({
					subtitle: "Cline wants to create a github issue...",
					message: `Cline is suggesting to create a github issue with the title: ${title}`,
				})
			}

			// Derive system information values algorithmically
			const operatingSystem = os.platform() + " " + os.release()
			const clineVersion =
				vscode.extensions.getExtension("saoudrizwan.claude-dev")?.packageJSON.version || "Unknown"
			const systemInfo = `VSCode: ${vscode.version}, Node.js: ${process.version}, Architecture: ${os.arch()}`
			const providerAndModel = `${(await getGlobalState(this.getContext(), "apiProvider")) as string} / ${this.api.getModel().id}`

			// Ask user for confirmation
			const bugReportData = JSON.stringify({
				title,
				what_happened,
				steps_to_reproduce,
				api_request_output,
				additional_context,
				// Include derived values in the JSON for display purposes
				provider_and_model: providerAndModel,
				operating_system: operatingSystem,
				system_info: systemInfo,
				cline_version: clineVersion,
			})

			const { text, images } = await this.ask("report_bug", bugReportData, false)

			// If the user provided a response, treat it as feedback
			if (text || images?.length) {
				await this.say("user_feedback", text ?? "", images)
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
					params.set("operating-system", operatingSystem)
					params.set("cline-version", clineVersion)
					params.set("system-info", systemInfo)
					params.set("additional-context", additional_context)
					params.set("what-happened", what_happened)
					params.set("steps", steps_to_reproduce)
					params.set("provider-model", providerAndModel)
					params.set("logs", api_request_output)

					// Use our utility function to create and open the GitHub issue URL
					// This bypasses VS Code's URI handling issues with special characters
					await createAndOpenGitHubIssue("cline", "cline", "bug_report.yml", params)
				} catch (error) {
					console.error(`An error occurred while attempting to report the bug: ${error}`)
				}
			}
			await this.saveCheckpoint()
			break
		}
	} catch (error) {
		await handleError("reporting bug", error)
		await this.saveCheckpoint()
		break
	}
}
