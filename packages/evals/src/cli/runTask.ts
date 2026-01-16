import * as fs from "fs"
import * as fsp from "fs/promises"
import * as path from "path"
import * as os from "node:os"

import pWaitFor from "p-wait-for"
import { execa } from "execa"

import {
	type TaskEvent,
	type ClineSay,
	TaskCommandName,
	RooCodeEventName,
	IpcMessageType,
	EVALS_SETTINGS,
	type ToolUsage,
} from "@roo-code/types"
import { IpcClient } from "@roo-code/ipc"

import {
	type Run,
	type Task,
	findRun,
	findTask,
	updateTask,
	createTaskMetrics,
	updateTaskMetrics,
	createToolError,
} from "../db/index.js"
import { EVALS_REPO_PATH } from "../exercises/index.js"

import { Logger, getTag, isDockerContainer } from "./utils.js"
import { redisClient, getPubSubKey, registerRunner, deregisterRunner } from "./redis.js"
import { runUnitTest } from "./runUnitTest.js"
import { MessageLogDeduper } from "./messageLogDeduper.js"

class SubprocessTimeoutError extends Error {
	constructor(timeout: number) {
		super(`Subprocess timeout after ${timeout}ms`)
		this.name = "SubprocessTimeoutError"
	}
}

/**
 * Copy conversation history files from VS Code extension storage to the log directory.
 * This allows us to preserve the api_conversation_history.json and ui_messages.json
 * files for post-mortem analysis alongside the log files.
 */
async function copyConversationHistory({
	rooTaskId,
	logDir,
	language,
	exercise,
	iteration,
	logger,
}: {
	rooTaskId: string
	logDir: string
	language: string
	exercise: string
	iteration: number
	logger: Logger
}): Promise<void> {
	// VS Code extension global storage path within the container
	const extensionStoragePath = "/roo/.vscode/User/globalStorage/rooveterinaryinc.roo-cline"
	const taskStoragePath = path.join(extensionStoragePath, "tasks", rooTaskId)

	const filesToCopy = ["api_conversation_history.json", "ui_messages.json"]

	for (const filename of filesToCopy) {
		const sourcePath = path.join(taskStoragePath, filename)
		// Use sanitized exercise name (replace slashes with dashes) for the destination filename
		// Include iteration number to handle multiple attempts at the same exercise
		const sanitizedExercise = exercise.replace(/\//g, "-")
		const destFilename = `${language}-${sanitizedExercise}.${iteration}_${filename}`
		const destPath = path.join(logDir, destFilename)

		try {
			// Check if source file exists
			await fsp.access(sourcePath)

			// Copy the file
			await fsp.copyFile(sourcePath, destPath)
			logger.info(`copied ${filename} to ${destPath}`)
		} catch (error) {
			// File may not exist if task didn't complete properly - this is not fatal
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				logger.info(`${filename} not found at ${sourcePath} - skipping`)
			} else {
				logger.error(`failed to copy ${filename}:`, error)
			}
		}
	}
}

export const processTask = async ({
	taskId,
	jobToken,
	logger,
}: {
	taskId: number
	jobToken: string | null
	logger?: Logger
}) => {
	const task = await findTask(taskId)
	const { language, exercise } = task
	const run = await findRun(task.runId)
	await registerRunner({ runId: run.id, taskId, timeoutSeconds: (run.timeout || 5) * 60 })

	const containerized = isDockerContainer()

	logger =
		logger ||
		new Logger({
			logDir: containerized ? `/var/log/evals/runs/${run.id}` : `/tmp/evals/runs/${run.id}`,
			filename: `${language}-${exercise}.log`,
			tag: getTag("runTask", { run, task }),
		})

	try {
		const publish = async (e: TaskEvent) => {
			const redis = await redisClient()
			await redis.publish(getPubSubKey(run.id), JSON.stringify(e))
		}

		logger.info(`running task ${task.id} (${language}/${exercise})...`)
		await runTask({ run, task, jobToken, publish, logger })

		logger.info(`testing task ${task.id} (${language}/${exercise})...`)
		const passed = await runUnitTest({ task, logger })

		logger.info(`task ${task.id} (${language}/${exercise}) -> ${passed}`)
		await updateTask(task.id, { passed })

		await publish({
			eventName: passed ? RooCodeEventName.EvalPass : RooCodeEventName.EvalFail,
			taskId: task.id,
		})
	} finally {
		await deregisterRunner({ runId: run.id, taskId })
	}
}

export const processTaskInContainer = async ({
	taskId,
	jobToken,
	logger,
	maxRetries = 10,
}: {
	taskId: number
	jobToken: string | null
	logger: Logger
	maxRetries?: number
}) => {
	const baseArgs = [
		"--rm",
		"--network evals_default",
		"-v /var/run/docker.sock:/var/run/docker.sock",
		"-v /tmp/evals:/var/log/evals",
		"-e HOST_EXECUTION_METHOD=docker",
	]

	if (jobToken) {
		baseArgs.push(`-e ROO_CODE_CLOUD_TOKEN=${jobToken}`)
	}

	const command = `pnpm --filter @roo-code/evals cli --taskId ${taskId}`
	logger.info(command)

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const containerName = `evals-task-${taskId}.${attempt}`
		const args = [`--name ${containerName}`, `-e EVALS_ATTEMPT=${attempt}`, ...baseArgs]
		const isRetry = attempt > 0

		if (isRetry) {
			const delayMs = Math.pow(2, attempt - 1) * 1000 * (0.5 + Math.random())
			logger.info(`retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`)
			await new Promise((resolve) => setTimeout(resolve, delayMs))
		}

		logger.info(
			`${isRetry ? "retrying" : "executing"} container command (attempt ${attempt + 1}/${maxRetries + 1})`,
		)

		const subprocess = execa(`docker run ${args.join(" ")} evals-runner sh -c "${command}"`, { shell: true })
		// subprocess.stdout?.on("data", (data) => console.log(data.toString()))
		// subprocess.stderr?.on("data", (data) => console.error(data.toString()))

		try {
			const result = await subprocess
			logger.info(`container process completed with exit code: ${result.exitCode}`)
			return
		} catch (error) {
			if (error && typeof error === "object" && "exitCode" in error) {
				logger.error(
					`container process failed with exit code: ${error.exitCode} (attempt ${attempt + 1}/${maxRetries + 1})`,
				)
			} else {
				logger.error(`container process failed with error: ${error} (attempt ${attempt + 1}/${maxRetries + 1})`)
			}

			if (attempt === maxRetries) {
				break
			}
		}
	}

	logger.error(`all ${maxRetries + 1} attempts failed, giving up`)

	// TODO: Mark task as failed.
}

type RunTaskOptions = {
	run: Run
	task: Task
	jobToken: string | null
	publish: (taskEvent: TaskEvent) => Promise<void>
	logger: Logger
}

export const runTask = async ({ run, task, publish, logger, jobToken }: RunTaskOptions) => {
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

			// Merge incoming tool usage with accumulated data using MAX strategy.
			// This handles the case where a task is rehydrated after abort:
			// - Empty rehydrated data won't overwrite existing: max(5, 0) = 5
			// - Legitimate restart with additional work is captured: max(5, 8) = 8
			// Each task instance tracks its own cumulative values, so we take the max
			// to preserve the highest values seen across all instances.
			for (const [toolName, usage] of Object.entries(incomingToolUsage)) {
				const existing = accumulatedToolUsage[toolName as keyof ToolUsage]
				if (existing) {
					accumulatedToolUsage[toolName as keyof ToolUsage] = {
						attempts: Math.max(existing.attempts, usage.attempts),
						failures: Math.max(existing.failures, usage.failures),
					}
				} else {
					accumulatedToolUsage[toolName as keyof ToolUsage] = { ...usage }
				}
			}

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

	// Wait for subprocess to finish gracefully, with a timeout.
	const SUBPROCESS_TIMEOUT = 10_000

	try {
		await Promise.race([
			subprocess,
			new Promise((_, reject) =>
				setTimeout(() => reject(new SubprocessTimeoutError(SUBPROCESS_TIMEOUT)), SUBPROCESS_TIMEOUT),
			),
		])

		logger.info("subprocess finished gracefully")
	} catch (error) {
		if (error instanceof SubprocessTimeoutError) {
			logger.error("subprocess did not finish within timeout, force killing")

			try {
				if (subprocess.kill("SIGKILL")) {
					logger.info("SIGKILL sent to subprocess")
				} else {
					logger.error("failed to send SIGKILL to subprocess")
				}
			} catch (killError) {
				logger.error("subprocess.kill(SIGKILL) failed:", killError)
			}
		} else {
			throw error
		}
	}

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
