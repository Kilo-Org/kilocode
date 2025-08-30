import { TelemetryService } from "@roo-code/telemetry"
import { getCheckpointService } from ".."
import { DIFF_VIEW_URI_SCHEME } from "../../../integrations/editor/DiffViewProvider"
import { Task } from "../../task/Task"
import { t } from "../../../i18n"
import * as vscode from "vscode"

function findLast<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean): number {
	let index = array.length - 1
	for (; index >= 0; index--) {
		if (predicate(array[index], index, array)) {
			break
		}
	}
	return index
}

export async function showNewChanges(cline: Task, { ts }: { ts: number }) {
	try {
		const service = await getCheckpointService(cline)
		if (!service) {
			return
		}

		const clineMessages = cline.clineMessages
		const currentCompletionResultIndex = clineMessages.findIndex(
			(msg) => msg.type === "say" && msg.say === "completion_result" && msg.ts === ts,
		)
		const currentCheckpointIndex = findLast(
			clineMessages.slice(0, currentCompletionResultIndex),
			(msg) => msg.type === "say" && msg.say === "checkpoint_saved",
		)

		const previousCompletionResultIndex = findLast(
			clineMessages.slice(0, currentCheckpointIndex),
			(msg) => msg.type === "say" && msg.say === "completion_result",
		)
		const previousCheckpointIndex =
			previousCompletionResultIndex >= 0
				? findLast(
						clineMessages.slice(0, previousCompletionResultIndex),
						(msg) => msg.type === "say" && msg.say === "checkpoint_saved",
					)
				: clineMessages.findIndex((msg) => msg.type === "say" && msg.say === "checkpoint_saved")

		const changes = await service.getDiff({
			from: clineMessages[previousCheckpointIndex]?.text,
			to: clineMessages[currentCheckpointIndex]?.text,
		})
		if (!changes?.length) {
			vscode.window.showWarningMessage(t("kilocode:showNewChanges.noChanges"))
			return
		}

		await vscode.commands.executeCommand(
			"vscode.changes",
			t("kilocode:showNewChanges.title"),
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
		vscode.window.showErrorMessage(t("kilocode:showNewChanges.error"))
		TelemetryService.instance.captureException(err, { context: "showNewChanges" })
	}
}
