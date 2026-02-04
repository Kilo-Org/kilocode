import fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import delay from "delay"

import { CommandExecutionStatus, DEFAULT_TERMINAL_OUTPUT_PREVIEW_SIZE, PersistedCommandOutput } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../task/Task"

import { ToolUse, ToolResponse } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import { ExitCodeDetails, RooTerminalCallbacks, RooTerminalProcess } from "../../integrations/terminal/types"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../integrations/terminal/Terminal"
import { OutputInterceptor } from "../../integrations/terminal/OutputInterceptor"
import { Package } from "../../shared/package"
import { t } from "../../i18n"
import { getTaskDirectoryPath } from "../../utils/storage"
import { BaseTool, ToolCallbacks } from "./BaseTool"

class ShellIntegrationError extends Error {}

interface ExecuteCommandParams {
	command: string
	cwd?: string
}

export class ExecuteCommandTool extends BaseTool<"execute_command"> {
	readonly name = "execute_command" as const

	async execute(params: ExecuteCommandParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { command, cwd: customCwd } = params
		const { handleError, pushToolResult, askApproval } = callbacks

		try {
			if (!command) {
				task.consecutiveMistakeCount++
				task.recordToolError("execute_command")
				pushToolResult(await task.sayAndCreateMissingParamError("execute_command", "command"))
				return
			}

			const ignoredFileAttemptedToAccess = task.rooIgnoreController?.validateCommand(command)

			if (ignoredFileAttemptedToAccess) {
				await task.say("rooignore_error", ignoredFileAttemptedToAccess)
				pushToolResult(formatResponse.rooIgnoreError(ignoredFileAttemptedToAccess))
				return
			}

			task.consecutiveMistakeCount = 0

			const unescapedCommand = unescapeHtmlEntities(command)
			const didApprove = await askApproval("command", unescapedCommand)

			if (!didApprove) {
				return
			}

			const executionId = task.lastMessageTs?.toString() ?? Date.now().toString()
			const provider = await task.providerRef.deref()
			const providerState = await provider?.getState()

			const { terminalShellIntegrationDisabled = true } = providerState ?? {}

			// Get command execution timeout from VSCode configuration (in seconds)
			const commandExecutionTimeoutSeconds = vscode.workspace
				.getConfiguration(Package.name)
				.get<number>("commandExecutionTimeout", 0)

			// Get command timeout allowlist from VSCode configuration
			const commandTimeoutAllowlist = vscode.workspace
				.getConfiguration(Package.name)
				.get<string[]>("commandTimeoutAllowlist", [])

			// Check if command matches any prefix in the allowlist
			const isCommandAllowlisted = commandTimeoutAllowlist.some((prefix) =>
				unescapedCommand.startsWith(prefix.trim()),
			)

			// Convert seconds to milliseconds for internal use, but skip timeout if command is allowlisted
			const commandExecutionTimeout = isCommandAllowlisted ? 0 : commandExecutionTimeoutSeconds * 1000

			const options: ExecuteCommandOptions = {
				executionId,
				command: unescapedCommand,
				customCwd,
				terminalShellIntegrationDisabled,
				commandExecutionTimeout,
			}

			try {
				const [rejected, result] = await executeCommandInTerminal(task, options)

				if (rejected) {
					task.didRejectTool = true
				}

				pushToolResult(result)
			} catch (error: unknown) {
				const status: CommandExecutionStatus = { executionId, status: "fallback" }
				provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
				await task.say("shell_integration_warning")

				// Invalidate pending ask from first execution to prevent race condition
				task.supersedePendingAsk()

				if (error instanceof ShellIntegrationError) {
					const [rejected, result] = await executeCommandInTerminal(task, {
						...options,
						terminalShellIntegrationDisabled: true,
					})

					if (rejected) {
						task.didRejectTool = true
					}

					pushToolResult(result)
				} else {
					pushToolResult(`Command failed to execute in terminal due to a shell integration error.`)
				}
			}

			return
		} catch (error) {
			await handleError("executing command", error as Error)
			return
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"execute_command">): Promise<void> {
		const command = block.params.command
		await task.ask("command", command ?? "", block.partial).catch(() => {})
	}
}

export type ExecuteCommandOptions = {
	executionId: string
	command: string
	customCwd?: string
	terminalShellIntegrationDisabled?: boolean
	commandExecutionTimeout?: number
}

export async function executeCommandInTerminal(
	task: Task,
	{
		executionId,
		command,
		customCwd,
		terminalShellIntegrationDisabled = true,
		commandExecutionTimeout = 0,
	}: ExecuteCommandOptions,
): Promise<[boolean, ToolResponse]> {
	// Convert milliseconds back to seconds for display purposes.
	const commandExecutionTimeoutSeconds = commandExecutionTimeout / 1000
	let workingDir: string

	if (!customCwd) {
		workingDir = task.cwd
	} else if (path.isAbsolute(customCwd)) {
		workingDir = customCwd
	} else {
		workingDir = path.resolve(task.cwd, customCwd)
	}

	try {
		await fs.access(workingDir)
	} catch (error) {
		return [false, `Working directory '${workingDir}' does not exist.`]
	}

	let message: { text?: string; images?: string[] } | undefined
	let runInBackground = false
	let completed = false
	let result: string = ""
	let persistedResult: PersistedCommandOutput | undefined
	let exitDetails: ExitCodeDetails | undefined
	let shellIntegrationError: string | undefined
	let hasAskedForCommandOutput = false

	const terminalProvider = terminalShellIntegrationDisabled ? "execa" : "vscode"
	const provider = await task.providerRef.deref()

	// Get global storage path for persisted output artifacts
	const globalStoragePath = provider?.context?.globalStorageUri?.fsPath
	let interceptor: OutputInterceptor | undefined

	// Create OutputInterceptor if we have storage available
	if (globalStoragePath) {
		const taskDir = await getTaskDirectoryPath(globalStoragePath, task.taskId)
		const storageDir = path.join(taskDir, "command-output")
		const providerState = await provider?.getState()
		const terminalOutputPreviewSize =
			providerState?.terminalOutputPreviewSize ?? DEFAULT_TERMINAL_OUTPUT_PREVIEW_SIZE

		interceptor = new OutputInterceptor({
			executionId,
			taskId: task.taskId,
			command,
			storageDir,
			previewSize: terminalOutputPreviewSize,
		})
	}

	let accumulatedOutput = ""
	// Bound accumulated output buffer size to prevent unbounded memory growth for long-running commands.
	// The interceptor preserves full output; this buffer is only for UI display (100KB limit).
	const maxAccumulatedOutputSize = 100_000

	// Track when onCompleted callback finishes to avoid race condition.
	// The callback is async but Terminal/ExecaTerminal don't await it, so we track completion
	// explicitly to ensure persistedResult is set before we use it.
	let onCompletedPromise: Promise<void> | undefined
	let resolveOnCompleted: (() => void) | undefined
	onCompletedPromise = new Promise((resolve) => {
		resolveOnCompleted = resolve
	})

	const callbacks: RooTerminalCallbacks = {
		onLine: async (lines: string, process: RooTerminalProcess) => {
			accumulatedOutput += lines

			// Trim accumulated output to prevent unbounded memory growth
			if (accumulatedOutput.length > maxAccumulatedOutputSize) {
				accumulatedOutput = accumulatedOutput.slice(-maxAccumulatedOutputSize)
			}

			// Write to interceptor for persisted output
			interceptor?.write(lines)

			// Continue sending compressed output to webview for UI display (unchanged behavior)
			const compressedOutput = Terminal.compressTerminalOutput(accumulatedOutput)
			const status: CommandExecutionStatus = { executionId, status: "output", output: compressedOutput }
			provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })

			if (runInBackground || hasAskedForCommandOutput) {
				return
			}

			// Mark that we've asked to prevent multiple concurrent asks
			hasAskedForCommandOutput = true

			try {
				const { response, text, images } = await task.ask("command_output", "")
				runInBackground = true

				if (response === "messageResponse") {
					message = { text, images }
					process.continue()
				}
			} catch (_error) {
				// Silently handle ask errors (e.g., "Current ask promise was ignored")
			}
		},
		onCompleted: async (output: string | undefined) => {
			try {
				// Finalize interceptor and get persisted result.
				// We await finalize() to ensure the artifact file is fully flushed
				// before we advertise the artifact_id to the LLM.
				if (interceptor) {
					persistedResult = await interceptor.finalize()
				}

				// Continue using compressed output for UI display
				result = Terminal.compressTerminalOutput(output ?? "")

				task.say("command_output", result)
				completed = true
			} finally {
				// Signal that onCompleted has finished, so the main code can safely use persistedResult
				resolveOnCompleted?.()
			}
		},
		onShellExecutionStarted: (pid: number | undefined) => {
			const status: CommandExecutionStatus = { executionId, status: "started", pid, command }
			provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
		},
		onShellExecutionComplete: (details: ExitCodeDetails) => {
			const status: CommandExecutionStatus = { executionId, status: "exited", exitCode: details.exitCode }
			provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
			exitDetails = details
		},
	}

	if (terminalProvider === "vscode") {
		callbacks.onNoShellIntegration = async (error: string) => {
			TelemetryService.instance.captureShellIntegrationError(task.taskId)
			shellIntegrationError = error
		}
	}

	const terminal = await TerminalRegistry.getOrCreateTerminal(workingDir, task.taskId, terminalProvider)

	if (terminal instanceof Terminal) {
		terminal.terminal.show(true)

		// Update the working directory in case the terminal we asked for has
		// a different working directory so that the model will know where the
		// command actually executed.
		workingDir = terminal.getCurrentWorkingDirectory()
	}

	const process = terminal.runCommand(command, callbacks)
	task.terminalProcess = process

	// Implement command execution timeout (skip if timeout is 0).
	if (commandExecutionTimeout > 0) {
		let timeoutId: NodeJS.Timeout | undefined
		let isTimedOut = false

		const timeoutPromise = new Promise<void>((_, reject) => {
			timeoutId = setTimeout(() => {
				isTimedOut = true
				task.terminalProcess?.abort()
				reject(new Error(`Command execution timed out after ${commandExecutionTimeout}ms`))
			}, commandExecutionTimeout)
		})

		try {
			await Promise.race([process, timeoutPromise])
		} catch (error) {
			if (isTimedOut) {
				const status: CommandExecutionStatus = { executionId, status: "timeout" }
				provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
				await task.say("error", t("common:errors:command_timeout", { seconds: commandExecutionTimeoutSeconds }))
				task.didToolFailInCurrentTurn = true
				task.terminalProcess = undefined

				return [
					false,
					`The command was terminated after exceeding a user-configured ${commandExecutionTimeoutSeconds}s timeout. Do not try to re-run the command.`,
				]
			}
			throw error
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId)
			}

			task.terminalProcess = undefined
		}
	} else {
		// No timeout - just wait for the process to complete.
		try {
			await process
		} finally {
			task.terminalProcess = undefined
		}
	}

	if (shellIntegrationError) {
		throw new ShellIntegrationError(shellIntegrationError)
	}

	// Wait for a short delay to ensure all messages are sent to the webview.
	// This delay allows time for non-awaited promises to be created and
	// for their associated messages to be sent to the webview, maintaining
	// the correct order of messages (although the webview is smart about
	// grouping command_output messages despite any gaps anyways).
	await delay(50)

	// Wait for onCompleted callback to finish if shell execution completed.
	// This ensures persistedResult is set before we try to use it, fixing the race
	// condition where exitDetails is set (sync) before the async onCompleted finishes.
	if (exitDetails && onCompletedPromise) {
		await onCompletedPromise
	}

	if (message) {
		const { text, images } = message
		await task.say("user_feedback", text, images)

		return [
			true,
			formatResponse.toolResult(
				[
					`Command is still running in terminal from '${terminal.getCurrentWorkingDirectory().toPosix()}'.`,
					result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
					`<user_message>\n${text}\n</user_message>`,
				].join("\n"),
				images,
			),
		]
	} else if (completed || exitDetails) {
		const currentWorkingDir = terminal.getCurrentWorkingDirectory().toPosix()

		// Use persisted output format when output was truncated and spilled to disk
		if (persistedResult?.truncated) {
			return [false, formatPersistedOutput(persistedResult, exitDetails, currentWorkingDir)]
		}

		// Use inline format for small outputs (original behavior with exit status)
		let exitStatus: string = ""

		if (exitDetails !== undefined) {
			if (exitDetails.signalName) {
				exitStatus = `Process terminated by signal ${exitDetails.signalName}`

				if (exitDetails.coreDumpPossible) {
					exitStatus += " - core dump possible"
				}
			} else if (exitDetails.exitCode === undefined) {
				result += "<VSCE exit code is undefined: terminal output and command execution status is unknown.>"
				exitStatus = `Exit code: <undefined, notify user>`
			} else {
				if (exitDetails.exitCode !== 0) {
					exitStatus += "Command execution was not successful, inspect the cause and adjust as needed.\n"
				}

				exitStatus += `Exit code: ${exitDetails.exitCode}`
			}
		} else {
			result += "<VSCE exitDetails == undefined: terminal output and command execution status is unknown.>"
			exitStatus = `Exit code: <undefined, notify user>`
		}

		return [
			false,
			`Command executed in terminal within working directory '${currentWorkingDir}'. ${exitStatus}\nOutput:\n${result}`,
		]
	} else {
		return [
			false,
			[
				`Command is still running in terminal ${workingDir ? ` from '${workingDir.toPosix()}'` : ""}.`,
				result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
				"You will be updated on the terminal status and new output in the future.",
			].join("\n"),
		]
	}
}

/**
 * Format exit status from ExitCodeDetails
 */
function formatExitStatus(exitDetails: ExitCodeDetails | undefined): string {
	if (exitDetails === undefined) {
		return "Exit code: <undefined, notify user>"
	}

	if (exitDetails.signalName) {
		let status = `Process terminated by signal ${exitDetails.signalName}`
		if (exitDetails.coreDumpPossible) {
			status += " - core dump possible"
		}
		return status
	}

	if (exitDetails.exitCode === undefined) {
		return "Exit code: <undefined, notify user>"
	}

	let status = ""
	if (exitDetails.exitCode !== 0) {
		status += "Command execution was not successful, inspect the cause and adjust as needed.\n"
	}
	status += `Exit code: ${exitDetails.exitCode}`
	return status
}

/**
 * Format persisted output result for tool response when output was truncated
 */
function formatPersistedOutput(
	result: PersistedCommandOutput,
	exitDetails: ExitCodeDetails | undefined,
	workingDir: string,
): string {
	const exitStatus = formatExitStatus(exitDetails)
	const sizeStr = formatBytes(result.totalBytes)
	const artifactId = result.artifactPath ? path.basename(result.artifactPath) : ""

	return [
		`Command executed in '${workingDir}'. ${exitStatus}`,
		"",
		`Output (${sizeStr}) persisted. Artifact ID: ${artifactId}`,
		"",
		"Preview:",
		result.preview,
		"",
		"Use read_command_output tool to view full output if needed.",
	].join("\n")
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes}B`
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)}KB`
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export const executeCommandTool = new ExecuteCommandTool()
