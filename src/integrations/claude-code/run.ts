import * as vscode from "vscode"
import type Anthropic from "@anthropic-ai/sdk"
import { execa } from "execa"
import { ClaudeCodeMessage } from "./types"
import readline from "readline"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)

type ClaudeCodeOptions = {
	systemPrompt: string
	messages: Anthropic.Messages.MessageParam[]
	path?: string
	modelId?: string
}

type ProcessState = {
	partialData: string | null
	error: Error | null
	stderrLogs: string
	exitCode: number | null
}

export async function* runClaudeCode(options: ClaudeCodeOptions): AsyncGenerator<ClaudeCodeMessage | string> {
	const process = runProcess(options)

	const rl = readline.createInterface({
		input: process.stdout,
	})

	try {
		const processState: ProcessState = {
			error: null,
			stderrLogs: "",
			exitCode: null,
			partialData: null,
		}

		process.stderr.on("data", (data) => {
			processState.stderrLogs += data.toString()
		})

		process.on("close", (code) => {
			processState.exitCode = code
		})

		process.on("error", (err) => {
			processState.error = err
		})

		for await (const line of rl) {
			if (processState.error) {
				throw processState.error
			}

			if (line.trim()) {
				const chunk = parseChunk(line, processState)

				if (!chunk) {
					continue
				}

				yield chunk
			}
		}

		// We rely on the assistant message. If the output was truncated, it's better having a poorly formatted message
		// from which to extract something, than throwing an error/showing the model didn't return any messages.
		if (processState.partialData && processState.partialData.startsWith(`{"type":"assistant"`)) {
			yield processState.partialData
		}

		const { exitCode } = await process
		if (exitCode !== null && exitCode !== 0) {
			const errorOutput = processState.error?.message || processState.stderrLogs?.trim()
			throw new Error(
				`Claude Code process exited with code ${exitCode}.${errorOutput ? ` Error output: ${errorOutput}` : ""}`,
			)
		}
	} finally {
		rl.close()
		if (!process.killed) {
			process.kill()
		}
	}
}

// We want the model to use our custom tool format instead of built-in tools.
// Disabling built-in tools prevents tool-only responses and ensures text output.
const claudeCodeTools = [
	"Task",
	"Bash",
	"Glob",
	"Grep",
	"LS",
	"exit_plan_mode",
	"Read",
	"Edit",
	"MultiEdit",
	"Write",
	"NotebookRead",
	"NotebookEdit",
	"WebFetch",
	"TodoRead",
	"TodoWrite",
	"WebSearch",
].join(",")

const CLAUDE_CODE_TIMEOUT = 600000 // 10 minutes

function runProcess({ systemPrompt, messages, path: claudePath, modelId }: ClaudeCodeOptions) {
	const claudeExecutable = claudePath || "claude"

	// Create a temporary file for the system prompt to avoid command line length limits
	const tempDir = os.tmpdir()
	const tempFile = path.join(tempDir, `claude-system-prompt-${Date.now()}.txt`)

	// Write system prompt to temporary file synchronously to ensure it exists before process starts
	// This is important to avoid race conditions
	try {
		// Use synchronous write to ensure file exists before process starts
		const fsSync = require("fs")
		fsSync.writeFileSync(tempFile, systemPrompt, "utf-8")
	} catch (error) {
		console.error("Error writing system prompt to temp file:", error)
		throw new Error(`Failed to create system prompt file: ${error}`)
	}

	const args = [
		"-p",
		"--system-prompt-file",
		tempFile,
		"--verbose",
		"--output-format",
		"stream-json",
		"--disallowedTools",
		claudeCodeTools,
		// Roo Code will handle recursive calls
		"--max-turns",
		"1",
	]

	if (modelId) {
		args.push("--model", modelId)
	}

	const child = execa(claudeExecutable, args, {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			// The default is 32000. However, I've gotten larger responses, so we increase it unless the user specified it.
			CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || "64000",
		},
		cwd,
		maxBuffer: 1024 * 1024 * 1000,
		timeout: CLAUDE_CODE_TIMEOUT,
	})

	// Write messages to stdin after process is spawned
	// This avoids the E2BIG error on Linux when passing large messages as command line arguments
	// Linux has a per-argument limit of ~128KiB for execve() system calls
	const messagesJson = JSON.stringify(messages)

	// Use setImmediate to ensure the process has been spawned before writing to stdin
	// This prevents potential race conditions where stdin might not be ready
	setImmediate(() => {
		try {
			child.stdin.write(messagesJson, "utf8", (error) => {
				if (error) {
					console.error("Error writing to Claude Code stdin:", error)
					child.kill()
				}
			})
			child.stdin.end()
		} catch (error) {
			console.error("Error accessing Claude Code stdin:", error)
			child.kill()
		}
	})

	// Clean up the temporary file when the process ends
	child.on("close", () => {
		fs.unlink(tempFile).catch((error) => {
			console.error("Error cleaning up temp file:", error)
		})
	})

	return child
}

function parseChunk(data: string, processState: ProcessState) {
	if (processState.partialData) {
		processState.partialData += data

		const chunk = attemptParseChunk(processState.partialData)

		if (!chunk) {
			return null
		}

		processState.partialData = null
		return chunk
	}

	const chunk = attemptParseChunk(data)

	if (!chunk) {
		processState.partialData = data
	}

	return chunk
}

function attemptParseChunk(data: string): ClaudeCodeMessage | null {
	try {
		return JSON.parse(data)
	} catch (error) {
		console.error("Error parsing chunk:", error, data.length)
		return null
	}
}
