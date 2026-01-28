import * as fs from "fs"
import * as path from "path"
import * as os from "node:os"

import pWaitFor from "p-wait-for"
import { execa } from "execa"

import {
	type ClineSay,
	type ToolUsage,
	TaskCommandName,
	RooCodeEventName,
	IpcMessageType,
	EVALS_SETTINGS,
} from "@roo-code/types"
import { IpcClient } from "@roo-code/ipc"

import { updateTask, createTaskMetrics, updateTaskMetrics, createToolError } from "../db/index.js"
import { EVALS_REPO_PATH } from "../exercises/index.js"

import { type RunTaskOptions } from "./types.js"
import { isDockerContainer, copyConversationHistory, mergeToolUsage, waitForSubprocessWithTimeout } from "./utils.js"
import { MessageLogDeduper } from "./messageLogDeduper.js"

export const runTaskInVscode = async ({ run, task, publish, logger, jobToken }: RunTaskOptions) => {
	const { language, exercise } = task
	const prompt = fs.readFileSync(path.resolve(EVALS_REPO_PATH, `prompts/${language}.md`), "utf-8")
	const workspacePath = path.resolve(EVALS_REPO_PATH, language, exercise)
	const ipcSocketPath = path.resolve(os.tmpdir(), `evals-${run.id}-${task.id}.sock`)
	const env = { ROO_CODE_IPC_SOCKET_PATH: ipcSocketPath }
	const controller = new AbortController()
	const cancelSignal = controller.signal
	const containerized = isDockerContainer()
	const logDir = containerized ? `/var/log/evals/runs/${run.id}` : `/tmp/evals/runs/${run.id}`

	let codeCommand = containerized
		? `xvfb-run --auto-servernum --server-num=1 code --wait --log trace --disable-workspace-trust --disable-gpu --disable-lcd-text --no-sandbox --user-data-dir /roo/.vscode --password-store="basic" -n ${workspacePath}`
		: `code --disable-workspace-trust -n ${workspacePath}`

	if (jobToken) {
		codeCommand = `ROO_CODE_CLOUD_TOKEN=${jobToken} ${codeCommand}`
	}

	logger.info(codeCommand)

	// Sleep for a random amount of time between 5 and 10 seconds, unless we're
	// running in a container, in which case there are no issues with flooding
	// VSCode with new windows.
	if (!containerized) {
		await new Promise((resolve) => setTimeout(resolve, Math.random() * 5_000 + 5_000))
	}

	const subprocess = execa({ env, shell: "/bin/bash", cancelSignal })`${codeCommand}`

	// If debugging, add `--verbose` to `command` and uncomment the following line.
	// subprocess.stdout.pipe(process.stdout)

	// Give VSCode some time to spawn before connecting to its unix socket.
	await new Promise((resolve) => setTimeout(resolve, 3_000))
	let client: IpcClient | undefined = undefined
	let attempts = 5

	while (true) {
		try {
			client = new IpcClient(ipcSocketPath)
			await pWaitFor(() => client!.isReady, { interval: 250, timeout: 1_000 })
			break
		} catch (_error) {
			client?.disconnect()
			attempts--

			if (attempts <= 0) {
				logger.error(`unable to connect to IPC socket -> ${ipcSocketPath}`)
				throw new Error("Unable to connect.")
			}
		}
	}

	let taskStartedAt = Date.now()
	let taskFinishedAt: number | undefined
	let taskAbortedAt: number | undefined
	let taskTimedOut: boolean = false
	let taskMetricsId: number | undefined
	let rooTaskId: string | undefined
	let isClientDisconnected = false
	// Track accumulated tool usage across task instances (handles rehydration after abort)
	const accumulatedToolUsage: ToolUsage = {}

	// Promise that resolves when taskMetricsId is set, preventing race conditions
	// where TaskTokenUsageUpdated arrives before TaskStarted handler completes
	let resolveTaskMetricsReady: () => void
	const taskMetricsReady = new Promise<void>((resolve) => {
		resolveTaskMetricsReady = resolve
	})

	const ignoreEvents: Record<"broadcast" | "log", RooCodeEventName[]> = {
		broadcast: [RooCodeEventName.Message],
		log: [RooCodeEventName.TaskTokenUsageUpdated, RooCodeEventName.TaskAskResponded],
	}

	const loggableSays: ClineSay[] = [
		"error",
		"command_output",
		"rooignore_error",
		"diff_error",
		"condense_context",
		"condense_context_error",
		"api_req_rate_limit_wait",
		"api_req_retry_delayed",
		"api_req_retried",
	]

	let isApiUnstable = false
	const messageLogDeduper = new MessageLogDeduper()

	client.on(IpcMessageType.TaskEvent, async (taskEvent) => {
		const { eventName, payload } = taskEvent

		if (
			eventName === RooCodeEventName.Message &&
			payload[0].message.say &&
			["api_req_retry_delayed", "api_req_retried"].includes(payload[0].message.say)
		) {
			isApiUnstable = true
		}

		// Publish all events except for these to Redis.
		if (!ignoreEvents.broadcast.includes(eventName)) {
			await publish({ ...taskEvent, taskId: task.id })
		}

		// Log all events except for these.
		// For message events we only log non-partial messages.
		if (
			!ignoreEvents.log.includes(eventName) &&
			(eventName !== RooCodeEventName.Message ||
				(payload[0].message.say && loggableSays.includes(payload[0].message.say)) ||
				payload[0].message.partial !== true)
		) {
			// Dedupe identical repeated message events (same message.ts + same payload)
			if (eventName === RooCodeEventName.Message) {
				const action = payload[0]?.action as string | undefined
				const message = payload[0]?.message
				if (!messageLogDeduper.shouldLog(action, message)) {
					return
				}
			}

			// Extract tool name for tool-related messages for clearer logging
			let logEventName: string = eventName
			if (eventName === RooCodeEventName.Message && payload[0]?.message?.ask === "tool") {
				try {
					const textJson = JSON.parse(payload[0].message.text ?? "{}")
					if (textJson.tool) {
						logEventName = `${eventName} (tool: ${textJson.tool})`
					}
				} catch {
					// If parsing fails, use the default event name
				}
			} else if (eventName === RooCodeEventName.Message && payload[0]?.message?.ask === "command") {
				logEventName = `${eventName} (command)`
			} else if (eventName === RooCodeEventName.Message && payload[0]?.message?.ask === "completion_result") {
				logEventName = `${eventName} (completion_result)`
			}
			logger.info(`${logEventName} ->`, payload)
		}

		if (eventName === RooCodeEventName.TaskStarted) {
			taskStartedAt = Date.now()

			const taskMetrics = await createTaskMetrics({
				cost: 0,
				tokensIn: 0,
				tokensOut: 0,
				tokensContext: 0,
				duration: 0,
				cacheWrites: 0,
				cacheReads: 0,
			})

			await updateTask(task.id, { taskMetricsId: taskMetrics.id, startedAt: new Date() })

			taskStartedAt = Date.now()
			taskMetricsId = taskMetrics.id
			rooTaskId = payload[0]

			// Signal that taskMetricsId is now ready for other handlers
			resolveTaskMetricsReady()
		}

		if (eventName === RooCodeEventName.TaskToolFailed) {
			const [_taskId, toolName, error] = payload
			await createToolError({ taskId: task.id, toolName, error })
		}

		if (eventName === RooCodeEventName.TaskTokenUsageUpdated || eventName === RooCodeEventName.TaskCompleted) {
			// Wait for taskMetricsId to be set by the TaskStarted handler.
			// This prevents a race condition where these events arrive before
			// the TaskStarted handler finishes its async database operations.
			// Note: taskMetricsReady is also resolved on disconnect to prevent deadlock.
			await taskMetricsReady

			// Guard: taskMetricsReady may have been resolved due to disconnect
			// without taskMetricsId being set. Skip metrics update in this case.
			if (!taskMetricsId) {
				logger.info(`skipping metrics update: taskMetricsId not set (event: ${eventName})`)
				return
			}

			const duration = Date.now() - taskStartedAt

			const { totalCost, totalTokensIn, totalTokensOut, contextTokens, totalCacheWrites, totalCacheReads } =
				payload[1]

			// For both TaskTokenUsageUpdated and TaskCompleted: toolUsage is payload[2]
			const incomingToolUsage: ToolUsage = payload[2] ?? {}
			mergeToolUsage(accumulatedToolUsage, incomingToolUsage)

			await updateTaskMetrics(taskMetricsId, {
				cost: totalCost,
				tokensIn: totalTokensIn,
				tokensOut: totalTokensOut,
				tokensContext: contextTokens,
				duration,
				cacheWrites: totalCacheWrites ?? 0,
				cacheReads: totalCacheReads ?? 0,
				toolUsage: accumulatedToolUsage,
			})
		}

		if (eventName === RooCodeEventName.TaskAborted) {
			taskAbortedAt = Date.now()
		}

		if (eventName === RooCodeEventName.TaskCompleted) {
			taskFinishedAt = Date.now()
		}
	})

	client.on(IpcMessageType.Disconnect, async () => {
		logger.info(`disconnected from IPC socket -> ${ipcSocketPath}`)
		isClientDisconnected = true
		// Resolve taskMetricsReady to unblock any handlers waiting on it.
		// This prevents deadlock if TaskStarted never fired or threw before resolving.
		// The handlers check for taskMetricsId being set before proceeding.
		resolveTaskMetricsReady()
	})

	client.sendCommand({
		commandName: TaskCommandName.StartNewTask,
		data: {
			configuration: {
				...EVALS_SETTINGS,
				openRouterApiKey: process.env.OPENROUTER_API_KEY,
				...run.settings, // Allow the provided settings to override `openRouterApiKey`.
			},
			text: prompt,
		},
	})

	try {
		const timeoutMs = (run.timeout || 5) * 60 * 1_000 // Convert minutes to milliseconds
		await pWaitFor(() => !!taskFinishedAt || !!taskAbortedAt || isClientDisconnected, {
			interval: 1_000,
			timeout: timeoutMs,
		})
	} catch (_error) {
		taskTimedOut = true
		logger.error("time limit reached")

		if (rooTaskId && !isClientDisconnected) {
			logger.info("cancelling task")
			client.sendCommand({ commandName: TaskCommandName.CancelTask, data: rooTaskId })
			await new Promise((resolve) => setTimeout(resolve, 5_000)) // Allow some time for the task to cancel.
		}

		taskFinishedAt = Date.now()
	}

	if (!taskFinishedAt && !taskTimedOut) {
		logger.error("client disconnected before task finished")
		throw new Error("Client disconnected before task completion.")
	}

	// If the task was aborted unexpectedly or the client disconnected
	// unexpectedly, then throw to trigger a retry.
	logger.info("setting task finished at")
	await updateTask(task.id, { finishedAt: new Date() })

	if (rooTaskId && !isClientDisconnected) {
		logger.info("closing task")
		client.sendCommand({ commandName: TaskCommandName.CloseTask, data: rooTaskId })
		await new Promise((resolve) => setTimeout(resolve, 2_000)) // Allow some time for the window to close.
	}

	if (!isClientDisconnected) {
		logger.info("disconnecting client")
		client.disconnect()
	}

	logger.info("waiting for subprocess to finish")
	controller.abort()

	await waitForSubprocessWithTimeout({ subprocess, logger })

	// Copy conversation history files from VS Code extension storage to the log directory
	// for post-mortem analysis. Only do this in containerized mode where we have a known path.
	if (containerized && rooTaskId) {
		await copyConversationHistory({
			rooTaskId,
			logDir,
			language,
			exercise,
			iteration: task.iteration,
			logger,
		})
	}

	logger.close()

	// Only throw for API instability if the task didn't complete successfully.
	// If taskFinishedAt is set via TaskCompleted event, the task succeeded despite
	// API retries, so re-running from scratch would waste resources.
	if (isApiUnstable && !taskFinishedAt) {
		throw new Error("API is unstable, throwing to trigger a retry.")
	}
}
