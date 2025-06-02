import NodeCache from "node-cache"
import getFolderSize from "get-folder-size"

import { ClineMessage } from "../../shared/ExtensionMessage"
import { combineApiRequests } from "../../shared/combineApiRequests"
import { combineCommandSequences } from "../../shared/combineCommandSequences"
import { getApiMetrics } from "../../shared/getApiMetrics"
import { findLastIndex } from "../../shared/array"
import { HistoryItem } from "../../shared/HistoryItem"
import { getTaskDirectoryPath } from "../../utils/storage"

const taskSizeCache = new NodeCache({ stdTTL: 30, checkperiod: 5 * 60 })

export type TaskMetadataOptions = {
	messages: ClineMessage[]
	taskId: string
	taskNumber: number
	globalStoragePath: string
	workspace: string
	mode?: string // kilocode_change
	parentTaskId?: string // kilocode_change
	rootTaskId?: string // kilocode_change
}

export async function taskMetadata({
	messages,
	taskId,
	taskNumber,
	globalStoragePath,
	workspace,
	mode, // kilocode_change
	parentTaskId, // kilocode_change
	rootTaskId, // kilocode_change
}: TaskMetadataOptions) {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const taskMessage = messages[0] // First message is always the task say.

	const lastRelevantMessage =
		messages[findLastIndex(messages, (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))]

	let taskDirSize = taskSizeCache.get<number>(taskDir)

	if (taskDirSize === undefined) {
		try {
			taskDirSize = await getFolderSize.loose(taskDir)
			taskSizeCache.set<number>(taskDir, taskDirSize)
		} catch (error) {
			taskDirSize = 0
		}
	}

	const tokenUsage = getApiMetrics(combineApiRequests(combineCommandSequences(messages.slice(1))))

	const historyItem: HistoryItem = {
		id: taskId,
		number: taskNumber,
		ts: lastRelevantMessage.ts,
		task: taskMessage.text ?? "",
		tokensIn: tokenUsage.totalTokensIn,
		tokensOut: tokenUsage.totalTokensOut,
		cacheWrites: tokenUsage.totalCacheWrites,
		cacheReads: tokenUsage.totalCacheReads,
		totalCost: tokenUsage.totalCost,
		size: taskDirSize,
		workspace,
		mode, // kilocode_change
		parentTaskId, // kilocode_change
		rootTaskId, // kilocode_change
	}

	return { historyItem, tokenUsage }
}
