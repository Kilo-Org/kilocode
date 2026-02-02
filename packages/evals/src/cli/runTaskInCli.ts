import * as fs from "fs"
import * as path from "path"
import * as os from "node:os"

import pWaitFor from "p-wait-for"
import { execa } from "execa"

import { type ToolUsage, TaskCommandName, RooCodeEventName, IpcMessageType } from "@roo-code/types"
import { IpcClient } from "@roo-code/ipc"

import { updateTask, createTaskMetrics, updateTaskMetrics, createToolError } from "../db/index.js"
import { EVALS_REPO_PATH } from "../exercises/index.js"

import { type RunTaskOptions } from "./types.js"
import { mergeToolUsage, waitForSubprocessWithTimeout } from "./utils.js"

/**
 * Run a task using the Roo Code CLI (headless mode).
 * Uses the same IPC protocol as VSCode since the CLI loads the same extension bundle.
 */
export const runTaskWithCli = async ({ run, task, publish, logger, jobToken }: RunTaskOptions) => {
	const { language, exercise } = task
	const prompt = fs.readFileSync(path.resolve(EVALS_REPO_PATH, `prompts/${language}.md`), "utf-8")
	const workspacePath = path.resolve(EVALS_REPO_PATH, language, exercise)
	const ipcSocketPath = path.resolve(os.tmpdir(), `evals-cli-${run.id}-${task.id}.sock`)

	const env: Record<string, string> = {
		...(process.env as Record<string, string>),
		ROO_CODE_IPC_SOCKET_PATH: ipcSocketPath,
	}

	if (jobToken) {
		env.ROO_CODE_CLOUD_TOKEN = jobToken
	}

	const controller = new AbortController()
	const cancelSignal = controller.signal

	const cliArgs = [
		"--filter",
		"@roo-code/cli",
		"start",
		"--yes",
		"--exit-on-complete",
		"--reasoning-effort",
		"disabled",
		"--workspace",
		workspacePath,
	]

	if (run.settings?.mode) {
		cliArgs.push("-M", run.settings.mode)
	}

	if (run.settings?.apiProvider) {
		cliArgs.push("-p", run.settings.apiProvider)
	}

	const modelId = run.settings?.apiModelId || run.settings?.openRouterModelId

	if (modelId) {
		cliArgs.push("-m", modelId)
	}

	cliArgs.push(prompt)

	logger.info(`CLI command: pnpm ${cliArgs.join(" ")}`)

	const subprocess = execa("pnpm", cliArgs, { env, cancelSignal, cwd: process.cwd() })

	// Buffer for accumulating streaming output until we have complete lines.
	let stdoutBuffer = ""
	let stderrBuffer = ""

	// Track subprocess exit code - with -x flag the CLI exits immediately after task completion.
	let subprocessExitCode: number | null = null

	// Pipe CLI stdout/stderr to the logger for easier debugging.
	// Buffer output and only log complete lines to avoid fragmented token-by-token logging.
	// Use logger.raw() to output without the verbose prefix (timestamp, tag, etc).
	subprocess.stdout?.on("data", (data: Buffer) => {
		stdoutBuffer += data.toString()
		const lines = stdoutBuffer.split("\n")

		// Keep the last incomplete line in the buffer.
		stdoutBuffer = lines.pop() || ""

		// Log all complete lines without the verbose prefix.
		for (const line of lines) {
			if (line.trim()) {
				logger.raw(line)
			}
		}
	})

	subprocess.stderr?.on("data", (data: Buffer) => {
		stderrBuffer += data.toString()
		const lines = stderrBuffer.split("\n")

		// Keep the last incomplete line in the buffer.
		stderrBuffer = lines.pop() || ""

		// Log all complete lines without the verbose prefix.
		for (const line of lines) {
			if (line.trim()) {
				logger.raw(line)
			}
		}
	})

	// Log any remaining buffered output when the subprocess exits.
	subprocess.on("exit", (code) => {
		subprocessExitCode = code

		if (stdoutBuffer.trim()) {
			logger.raw(stdoutBuffer)
		}

		if (stderrBuffer.trim()) {
			logger.raw(stderrBuffer)
		}
	})

	// Give CLI some time to start and create IPC server.
	await new Promise((resolve) => setTimeout(resolve, 5_000))

	let client: IpcClient | undefined = undefined
	let attempts = 10 // More attempts for CLI startup.

	while (true) {
		try {
			client = new IpcClient(ipcSocketPath)
			await pWaitFor(() => client!.isReady, { interval: 500, timeout: 2_000 })
			break
		} catch (_error) {
			client?.disconnect()
			attempts--

			if (attempts <= 0) {
				logger.error(`unable to connect to IPC socket -> ${ipcSocketPath}`)
				throw new Error("Unable to connect to CLI IPC socket.")
			}

			// Wait a bit before retrying.
			await new Promise((resolve) => setTimeout(resolve, 1_000))
		}
	}

	// For CLI mode, we need to create taskMetrics immediately because the CLI starts
	// the task right away (from command line args). By the time we connect to IPC,
	// the TaskStarted event may have already been sent and missed.
	// This is different from VSCode mode where we send StartNewTask via IPC and can
	// reliably receive TaskStarted.
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
	logger.info(`created taskMetrics with id ${taskMetrics.id}`)

	// The rest of the logic handles IPC events for metrics updates.
	let taskStartedAt = Date.now()
	let taskFinishedAt: number | undefined
	let taskAbortedAt: number | undefined
	let taskTimedOut: boolean = false
	const taskMetricsId = taskMetrics.id // Already set, no need to wait for TaskStarted.
	let rooTaskId: string | undefined
	let isClientDisconnected = false
	const accumulatedToolUsage: ToolUsage = {}

	// For CLI mode, we don't need verbose IPC message logging since we're logging stdout instead.
	// We only track what's needed for metrics and task state management.
	const ignoreEventsForBroadcast = [RooCodeEventName.Message]
	let isApiUnstable = false

	client.on(IpcMessageType.TaskEvent, async (taskEvent) => {
		const { eventName, payload } = taskEvent

		// Track API instability for retry logic.
		if (
			eventName === RooCodeEventName.Message &&
			payload[0].message.say &&
			["api_req_retry_delayed", "api_req_retried"].includes(payload[0].message.say)
		) {
			isApiUnstable = true
		}

		// Publish events to Redis (except Message events) for the web UI.
		if (!ignoreEventsForBroadcast.includes(eventName)) {
			await publish({ ...taskEvent, taskId: task.id })
		}

		// Handle task lifecycle events.
		// For CLI mode, we already created taskMetrics before connecting to IPC,
		// but we still want to capture the rooTaskId from TaskStarted if we receive it.
		if (eventName === RooCodeEventName.TaskStarted) {
			taskStartedAt = Date.now()
			rooTaskId = payload[0]
			logger.info(`received TaskStarted event, rooTaskId: ${rooTaskId}`)
		}

		if (eventName === RooCodeEventName.TaskToolFailed) {
			const [_taskId, toolName, error] = payload
			await createToolError({ taskId: task.id, toolName, error })
		}

		if (eventName === RooCodeEventName.TaskTokenUsageUpdated || eventName === RooCodeEventName.TaskCompleted) {
			// In CLI mode, taskMetricsId is always set before we register event handlers.
			const duration = Date.now() - taskStartedAt

			const { totalCost, totalTokensIn, totalTokensOut, contextTokens, totalCacheWrites, totalCacheReads } =
				payload[1]

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
		// Note: In CLI mode, we don't need to resolve taskMetricsReady since
		// taskMetrics is created synchronously before event handlers are registered.
	})

	// Note: We do NOT send StartNewTask via IPC here because the CLI already
	// starts the task from its command line arguments. The IPC connection is
	// only used to receive events (TaskStarted, TaskCompleted, etc.) and metrics.
	// Sending StartNewTask here would start a SECOND task.

	try {
		const timeoutMs = (run.timeout || 5) * 60 * 1_000

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
			await new Promise((resolve) => setTimeout(resolve, 5_000))
		}

		taskFinishedAt = Date.now()
	}

	if (!taskFinishedAt && !taskTimedOut) {
		// With -x flag, CLI exits immediately after task completion, which can cause
		// IPC disconnection before we receive the TaskCompleted event.
		// If subprocess exited cleanly (code 0), treat as successful completion.
		if (subprocessExitCode === 0) {
			taskFinishedAt = Date.now()
			logger.info("subprocess exited cleanly (code 0), treating as task completion")
		} else {
			logger.error(`client disconnected before task finished (subprocess exit code: ${subprocessExitCode})`)
			throw new Error("Client disconnected before task completion.")
		}
	}

	logger.info("setting task finished at")
	await updateTask(task.id, { finishedAt: new Date() })

	if (rooTaskId && !isClientDisconnected) {
		logger.info("closing task")
		client.sendCommand({ commandName: TaskCommandName.CloseTask, data: rooTaskId })
		await new Promise((resolve) => setTimeout(resolve, 2_000))
	}

	if (!isClientDisconnected) {
		logger.info("disconnecting client")
		client.disconnect()
	}

	logger.info("waiting for subprocess to finish")
	controller.abort()

	await waitForSubprocessWithTimeout({ subprocess, logger })

	logger.close()

	if (isApiUnstable && !taskFinishedAt) {
		throw new Error("API is unstable, throwing to trigger a retry.")
	}
}
