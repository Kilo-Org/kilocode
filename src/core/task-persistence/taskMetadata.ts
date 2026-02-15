import NodeCache from "node-cache"
import getFolderSize from "get-folder-size"

import type { ClineMessage, HistoryItem, ToolProtocol } from "@roo-code/types"

import { combineApiRequests } from "../../shared/combineApiRequests"
import { combineCommandSequences } from "../../shared/combineCommandSequences"
import { getApiMetrics } from "../../shared/getApiMetrics"
import { findLastIndex } from "../../shared/array"
import { getTaskDirectoryPath } from "../../utils/storage"
import { t } from "../../i18n"

const taskSizeCache = new NodeCache({ stdTTL: 30, checkperiod: 5 * 60 })

export type TaskMetadataOptions = {
	taskId: string
	rootTaskId?: string
	parentTaskId?: string
	taskNumber: number
	messages: ClineMessage[]
	globalStoragePath: string
	workspace: string
	mode?: string
	/** Provider profile name for the task (sticky profile feature) */
	apiConfigName?: string
	/** Initial status for the task (e.g., "active" for child tasks) */
	initialStatus?: "active" | "delegated" | "completed"
	/**
	 * The tool protocol locked to this task. Once set, the task will
	 * continue using this protocol even if user settings change.
	 */
	toolProtocol?: ToolProtocol
	// kilocode_change start
	/**
	 * cumulative total cost including deleted messages.
	 * if provided, this overrides the calculated totalCost from messages.
	 */
	cumulativeTotalCost?: number
	// kilocode_change end
}

export async function taskMetadata({
	taskId: id,
	rootTaskId,
	parentTaskId,
	taskNumber,
	messages,
	globalStoragePath,
	workspace,
	mode,
	apiConfigName,
	initialStatus,
	toolProtocol,
	cumulativeTotalCost, // kilocode_change
}: TaskMetadataOptions) {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, id)

	// Determine message availability upfront
	const hasMessages = messages && messages.length > 0

	// Pre-calculate all values based on availability
	let timestamp: number
	let tokenUsage: ReturnType<typeof getApiMetrics>
	let taskDirSize: number
	let taskMessage: ClineMessage | undefined

	if (!hasMessages) {
		// Handle no messages case
		timestamp = Date.now()
		tokenUsage = {
			totalTokensIn: 0,
			totalTokensOut: 0,
			totalCacheWrites: 0,
			totalCacheReads: 0,
			totalCost: 0,
			contextTokens: 0,
		}
		taskDirSize = 0
	} else {
		// Handle messages case
		taskMessage = messages[0] // First message is always the task say.

		const lastRelevantMessage =
			messages[findLastIndex(messages, (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))] ||
			taskMessage

		timestamp = lastRelevantMessage.ts

		tokenUsage = getApiMetrics(combineApiRequests(combineCommandSequences(messages.slice(1))))

		// Get task directory size
		const cachedSize = taskSizeCache.get<number>(taskDir)

		if (cachedSize === undefined) {
			try {
				taskDirSize = await getFolderSize.loose(taskDir)
				taskSizeCache.set<number>(taskDir, taskDirSize)
			} catch (error) {
				taskDirSize = 0
			}
		} else {
			taskDirSize = cachedSize
		}
	}

	// Create historyItem once with pre-calculated values.
	// initialStatus is included when provided (e.g., "active" for child tasks)
	// to ensure the status is set from the very first save, avoiding race conditions
	// where attempt_completion might run before a separate status update.
	// toolProtocol is persisted to ensure tasks resume with the correct protocol
	// even if user settings have changed.
	const historyItem: HistoryItem = {
		id,
		rootTaskId,
		parentTaskId,
		number: taskNumber,
		ts: timestamp,
		task: hasMessages
			? taskMessage!.text?.trim() || t("common:tasks.incomplete", { taskNumber })
			: t("common:tasks.no_messages", { taskNumber }),
		tokensIn: tokenUsage.totalTokensIn,
		tokensOut: tokenUsage.totalTokensOut,
		cacheWrites: tokenUsage.totalCacheWrites,
		cacheReads: tokenUsage.totalCacheReads,
		totalCost: cumulativeTotalCost !== undefined ? cumulativeTotalCost : tokenUsage.totalCost, // kilocode_change
		size: taskDirSize,
		workspace,
		mode,
		...(toolProtocol && { toolProtocol }),
		...(typeof apiConfigName === "string" && apiConfigName.length > 0 ? { apiConfigName } : {}),
		...(initialStatus && { status: initialStatus }),
	}

	return { historyItem, tokenUsage }
}
