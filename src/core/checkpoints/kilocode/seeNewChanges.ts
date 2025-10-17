import { TelemetryService } from "@roo-code/telemetry"
import { getCheckpointService } from ".."
import { DIFF_VIEW_URI_SCHEME } from "../../../integrations/editor/DiffViewProvider"
import { Task } from "../../task/Task"
import { t } from "../../../i18n"
import * as vscode from "vscode"
import { CommitRange } from "@roo-code/types"

function findLast<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean): number {
	let index = array.length - 1
	for (; index >= 0; index--) {
		if (predicate(array[index], index, array)) {
			break
		}
	}
	return index
}

export async function getCommitRangeForNewCompletion(task: Task): Promise<CommitRange | undefined> {
	try {
		const service = await getCheckpointService(task)
		if (!service) {
			console.log("getCommitRangeForNewCompletion: no checkpoint service")
			return
		}

		const messages =
			task.clineMessages.at(-1)?.say === "completion_result"
				? task.clineMessages.slice(0, -1)
				: task.clineMessages

		const firstCompletionIndex = messages.findIndex((msg) => msg.type === "say" && msg.say === "completion_result")
		const messageWithFirstCommit = messages
			.slice(0, firstCompletionIndex >= 0 ? firstCompletionIndex : messages.length)
			.find((msg) => msg.type === "say" && msg.say === "checkpoint_saved")

		const previousCompletionIndex = findLast(
			messages,
			(msg) => msg.type === "say" && msg.say === "completion_result",
		)

		const lastCheckpointIndex = findLast(messages, (msg) => msg.type === "say" && msg.say === "checkpoint_saved")

		if (lastCheckpointIndex >= 0 && previousCompletionIndex >= 0 && lastCheckpointIndex < previousCompletionIndex) {
			console.log(
				`getCommitRangeForNewCompletion: last checkpoint ${lastCheckpointIndex} is older than previous completion ${previousCompletionIndex}.`,
			)
			return undefined
		}

		const previousCheckpointIndex =
			previousCompletionIndex >= 0
				? findLast(
						messages.slice(0, previousCompletionIndex),
						(msg) => msg.type === "say" && msg.say === "checkpoint_saved",
					)
				: -1

		const toCommit = lastCheckpointIndex >= 0 ? messages[lastCheckpointIndex].text : undefined
		const fromCommit =
			previousCheckpointIndex >= 0 ? messages[previousCheckpointIndex].text : messageWithFirstCommit?.text
		const fromTimeStamp =
			previousCheckpointIndex >= 0 ? messages[previousCheckpointIndex].ts : messageWithFirstCommit?.ts

		if (!toCommit || !fromCommit || fromCommit === toCommit) {
			console.log(`getCommitRangeForNewCompletion: invalid commit range '${fromCommit}' to '${toCommit}'.`)
			return undefined
		}

		const result = { from: fromCommit, fromTimeStamp: fromTimeStamp, to: toCommit }
		if ((await service.getDiff(result)).length === 0) {
			console.log(`getCommitRangeForNewCompletion: no changes in commit range '${fromCommit}' to '${toCommit}'.`)
			return undefined
		}

		return result
	} catch (err) {
		console.error("getCommitRangeForNewCompletion: exception", err)
		TelemetryService.instance.captureException(err, { context: "getCommitRangeForNewCompletion" })
		return undefined
	}
}

export async function seeNewChanges(task: Task, commitRange: CommitRange) {
	try {
		const service = await getCheckpointService(task)
		if (!service) {
			vscode.window.showWarningMessage(t("kilocode:seeNewChanges.checkpointsUnavailable"))
			return
		}

		const changes = await service.getDiff(commitRange)
		if (changes.length === 0) {
			vscode.window.showWarningMessage(t("kilocode:seeNewChanges.noChanges"))
			return
		}

		await vscode.commands.executeCommand(
			"vscode.changes",
			t("kilocode:seeNewChanges.title"),
			changes.map((change) => [
				vscode.Uri.file(change.paths.absolute),
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
					query: Buffer.from(change.content.before ?? "").toString("base64"),
				}),
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
					query: Buffer.from(change.content.after ?? "").toString("base64"),
				}),
			]),
		)
	} catch (err) {
		vscode.window.showErrorMessage(t("kilocode:seeNewChanges.error"))
		TelemetryService.instance.captureException(err, { context: "seeNewChanges" })
		return undefined
	}
}
