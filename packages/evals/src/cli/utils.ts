import * as fs from "fs"
import * as fsp from "fs/promises"
import * as path from "path"

import { execa, type ResultPromise } from "execa"

import type { ToolUsage } from "@roo-code/types"

import type { Run, Task } from "../db/index.js"

import { SubprocessTimeoutError } from "./types.js"

export const getTag = (caller: string, { run, task }: { run: Run; task?: Task }) =>
	task
		? `${caller} | pid:${process.pid} | run:${run.id} | task:${task.id} | ${task.language}/${task.exercise}`
		: `${caller} | pid:${process.pid} | run:${run.id}`

export const isDockerContainer = () => {
	try {
		return fs.existsSync("/.dockerenv")
	} catch (_error) {
		return false
	}
}

export const resetEvalsRepo = async ({ run, cwd }: { run: Run; cwd: string }) => {
	await execa({ cwd })`git config user.name "Roo Code"`
	await execa({ cwd })`git config user.email "support@roocode.com"`
	await execa({ cwd })`git checkout -f`
	await execa({ cwd })`git clean -fd`
	await execa({ cwd })`git checkout -b runs/${run.id}-${crypto.randomUUID().slice(0, 8)} main`
}

export const commitEvalsRepoChanges = async ({ run, cwd }: { run: Run; cwd: string }) => {
	await execa({ cwd })`git add .`
	await execa({ cwd })`git commit -m ${`Run #${run.id}`} --no-verify`
}

enum LogLevel {
	INFO = "INFO",
	ERROR = "ERROR",
	WARN = "WARN",
	DEBUG = "DEBUG",
}

interface LoggerOptions {
	logDir: string
	filename: string
	tag: string
}

export class Logger {
	private logStream: fs.WriteStream | undefined
	private logFilePath: string
	private tag: string

	constructor({ logDir, filename, tag }: LoggerOptions) {
		this.tag = tag
		this.logFilePath = path.join(logDir, filename)
		this.initializeLogger(logDir)
	}

	private initializeLogger(logDir: string): void {
		try {
			fs.mkdirSync(logDir, { recursive: true })
		} catch (error) {
			console.error(`Failed to create log directory ${logDir}:`, error)
		}

		try {
			this.logStream = fs.createWriteStream(this.logFilePath, { flags: "a" })
		} catch (error) {
			console.error(`Failed to create log file ${this.logFilePath}:`, error)
		}
	}

	private writeToLog(level: LogLevel, message: string, ...args: unknown[]) {
		try {
			const timestamp = new Date().toISOString()

			const logLine = `[${timestamp} | ${level} | ${this.tag}] ${message} ${
				args.length > 0 ? JSON.stringify(args) : ""
			}\n`

			console.log(logLine.trim())

			if (this.logStream) {
				this.logStream.write(logLine)
			}
		} catch (error) {
			console.error(`Failed to write to log file ${this.logFilePath}:`, error)
		}
	}

	public info(message: string, ...args: unknown[]): void {
		this.writeToLog(LogLevel.INFO, message, ...args)
	}

	public error(message: string, ...args: unknown[]): void {
		this.writeToLog(LogLevel.ERROR, message, ...args)
	}

	public warn(message: string, ...args: unknown[]): void {
		this.writeToLog(LogLevel.WARN, message, ...args)
	}

	public debug(message: string, ...args: unknown[]): void {
		this.writeToLog(LogLevel.DEBUG, message, ...args)
	}

	public log(message: string, ...args: unknown[]): void {
		this.info(message, ...args)
	}

	/**
	 * Write raw output without any prefix (timestamp, level, tag).
	 * Useful for streaming CLI output where the prefix would be noise.
	 */
	public raw(message: string): void {
		try {
			console.log(message)

			if (this.logStream) {
				this.logStream.write(message + "\n")
			}
		} catch (error) {
			console.error(`Failed to write to log file ${this.logFilePath}:`, error)
		}
	}

	public close(): void {
		if (this.logStream) {
			this.logStream.end()
			this.logStream = undefined
		}
	}
}

/**
 * Copy conversation history files from VS Code extension storage to the log directory.
 * This allows us to preserve the api_conversation_history.json and ui_messages.json
 * files for post-mortem analysis alongside the log files.
 */
export async function copyConversationHistory({
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

/**
 * Merge incoming tool usage with accumulated data using MAX strategy.
 * This handles the case where a task is rehydrated after abort:
 * - Empty rehydrated data won't overwrite existing: max(5, 0) = 5
 * - Legitimate restart with additional work is captured: max(5, 8) = 8
 * Each task instance tracks its own cumulative values, so we take the max
 * to preserve the highest values seen across all instances.
 */
export function mergeToolUsage(accumulated: ToolUsage, incoming: ToolUsage): void {
	for (const [toolName, usage] of Object.entries(incoming)) {
		const existing = accumulated[toolName as keyof ToolUsage]

		if (existing) {
			accumulated[toolName as keyof ToolUsage] = {
				attempts: Math.max(existing.attempts, usage.attempts),
				failures: Math.max(existing.failures, usage.failures),
			}
		} else {
			accumulated[toolName as keyof ToolUsage] = { ...usage }
		}
	}
}

/**
 * Wait for a subprocess to finish gracefully, with a timeout.
 * If the subprocess doesn't finish within the timeout, force kill it with SIGKILL.
 */
export async function waitForSubprocessWithTimeout({
	subprocess,
	timeoutMs = 10_000,
	logger,
}: {
	subprocess: ResultPromise
	timeoutMs?: number
	logger: Logger
}): Promise<void> {
	try {
		await Promise.race([
			subprocess,
			new Promise((_, reject) => setTimeout(() => reject(new SubprocessTimeoutError(timeoutMs)), timeoutMs)),
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
}
