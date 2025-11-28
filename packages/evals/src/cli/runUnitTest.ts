import * as path from "path"

import { execa, parseCommandString } from "execa"
import psList from "ps-list"

import type { Task } from "../db/index.js"
import { type ExerciseLanguage, EVALS_REPO_PATH } from "../exercises/index.js"

import { Logger } from "./utils.js"

// kilocode_change start
/**
 * Get child process IDs for a given parent PID
 */
async function getChildPids(parentPid: number): Promise<number[]> {
	try {
		const processes = await psList()
		return processes.filter((p) => p.ppid === parentPid).map((p) => p.pid)
	} catch (error) {
		console.error(`Failed to get child processes for PID ${parentPid}:`, error)
		return []
	}
}
// kilocode_change end

const UNIT_TEST_TIMEOUT = 2 * 60 * 1_000

const testCommands: Record<ExerciseLanguage, { commands: string[]; timeout?: number }> = {
	go: { commands: ["go test"] },
	java: { commands: ["./gradlew test"] },
	javascript: { commands: ["pnpm install", "pnpm test"] },
	python: { commands: ["uv run python3 -m pytest -o markers=task *_test.py"] },
	rust: { commands: ["cargo test"] },
}

type RunUnitTestOptions = {
	task: Task
	logger: Logger
}

export const runUnitTest = async ({ task, logger }: RunUnitTestOptions) => {
	const cmd = testCommands[task.language]
	const cwd = path.resolve(EVALS_REPO_PATH, task.language, task.exercise)
	const commands = cmd.commands.map((cs) => parseCommandString(cs))

	let passed = true

	for (const command of commands) {
		try {
			logger.info(`running "${command.join(" ")}"`)
			const subprocess = execa({ cwd, shell: "/bin/bash", reject: false })`${command}`
			subprocess.stdout.pipe(process.stdout)
			subprocess.stderr.pipe(process.stderr)

			const timeout = setTimeout(async () => {
				const descendants = await getChildPids(subprocess.pid!) // kilocode_change

				logger.info(
					`"${command.join(" ")}" timed out, killing ${subprocess.pid} + ${JSON.stringify(descendants)}`,
				)

				if (descendants.length > 0) {
					for (const descendant of descendants) {
						try {
							logger.info(`killing descendant process ${descendant}`)
							await execa`kill -9 ${descendant}`
						} catch (error) {
							logger.error(`failed to kill descendant process ${descendant}:`, error)
						}
					}
				}

				logger.info(`killing main process ${subprocess.pid}`)

				try {
					await execa`kill -9 ${subprocess.pid!}`
				} catch (error) {
					logger.error(`failed to kill main process ${subprocess.pid}:`, error)
				}
			}, UNIT_TEST_TIMEOUT)

			const result = await subprocess

			clearTimeout(timeout)

			if (result.failed) {
				passed = false
				break
			}
		} catch (error) {
			logger.error(`unexpected error:`, error)
			passed = false
			break
		}
	}

	return passed
}
