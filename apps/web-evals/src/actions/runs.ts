"use server"

import * as path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { spawn, execFileSync } from "child_process"

import { revalidatePath } from "next/cache"
import pMap from "p-map"

import {
	type ExerciseLanguage,
	exerciseLanguages,
	createRun as _createRun,
	deleteRun as _deleteRun,
	updateRun as _updateRun,
	getIncompleteRuns as _getIncompleteRuns,
	deleteRunsByIds as _deleteRunsByIds,
	createTask,
	getExercisesForLanguage,
} from "@roo-code/evals"

import { CreateRun } from "@/lib/schemas"
import { redisClient } from "@/lib/server/redis"

// Storage base path for eval logs
const EVALS_STORAGE_PATH = "/tmp/evals/runs"

const EVALS_REPO_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../evals")

export async function createRun({
	suite,
	exercises = [],
	timeout,
	iterations = 1,
	executionMethod = "vscode",
	...values
}: CreateRun) {
	const run = await _createRun({
		...values,
		timeout,
		executionMethod,
		socketPath: "", // TODO: Get rid of this.
	})

	if (suite === "partial") {
		for (const path of exercises) {
			const [language, exercise] = path.split("/")

			if (!language || !exercise) {
				throw new Error("Invalid exercise path: " + path)
			}

			// Create multiple tasks for each iteration
			for (let iteration = 1; iteration <= iterations; iteration++) {
				await createTask({
					...values,
					runId: run.id,
					language: language as ExerciseLanguage,
					exercise,
					iteration,
				})
			}
		}
	} else {
		for (const language of exerciseLanguages) {
			const languageExercises = await getExercisesForLanguage(EVALS_REPO_PATH, language)

			// Create tasks for all iterations of each exercise
			const tasksToCreate: Array<{ language: ExerciseLanguage; exercise: string; iteration: number }> = []
			for (const exercise of languageExercises) {
				for (let iteration = 1; iteration <= iterations; iteration++) {
					tasksToCreate.push({ language, exercise, iteration })
				}
			}

			await pMap(
				tasksToCreate,
				({ language, exercise, iteration }) => createTask({ runId: run.id, language, exercise, iteration }),
				{ concurrency: 10 },
			)
		}
	}

	revalidatePath("/runs")

	try {
		const isRunningInDocker = fs.existsSync("/.dockerenv")

		const dockerArgs = [
			`--name evals-controller-${run.id}`,
			"--rm",
			"--network evals_default",
			"-v /var/run/docker.sock:/var/run/docker.sock",
			"-v /tmp/evals:/var/log/evals",
			"-e HOST_EXECUTION_METHOD=docker",
		]

		const cliCommand = `pnpm --filter @roo-code/evals cli --runId ${run.id}`

		const command = isRunningInDocker
			? `docker run ${dockerArgs.join(" ")} evals-runner sh -c "${cliCommand}"`
			: cliCommand

		console.log("spawn ->", command)

		const childProcess = spawn("sh", ["-c", command], {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		})

		const logStream = fs.createWriteStream("/tmp/roo-code-evals.log", { flags: "a" })

		if (childProcess.stdout) {
			childProcess.stdout.pipe(logStream)
		}

		if (childProcess.stderr) {
			childProcess.stderr.pipe(logStream)
		}

		childProcess.unref()
	} catch (error) {
		console.error(error)
	}

	return run
}

export async function deleteRun(runId: number) {
	await _deleteRun(runId)
	revalidatePath("/runs")
}

export type KillRunResult = {
	success: boolean
	killedContainers: string[]
	errors: string[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Kill all Docker containers associated with a run (controller and task runners).
 * Kills the controller first, waits 10 seconds, then kills runners.
 * Also clears Redis state for heartbeat and runners.
 *
 * Container naming conventions:
 * - Controller: evals-controller-{runId}
 * - Task runners: evals-task-{runId}-{taskId}.{attempt}
 */
export async function killRun(runId: number): Promise<KillRunResult> {
	const killedContainers: string[] = []
	const errors: string[] = []
	const controllerPattern = `evals-controller-${runId}`
	const taskPattern = `evals-task-${runId}-`

	try {
		// Step 1: Kill the controller first
		console.log(`Killing controller: ${controllerPattern}`)
		try {
			execFileSync("docker", ["kill", controllerPattern], { encoding: "utf-8", timeout: 10000 })
			killedContainers.push(controllerPattern)
			console.log(`Killed controller container: ${controllerPattern}`)
		} catch (_error) {
			// Controller might not be running - that's ok, continue to kill runners
			console.log(`Controller ${controllerPattern} not running or already stopped`)
		}

		// Step 2: Wait 10 seconds before killing runners
		console.log("Waiting 10 seconds before killing runners...")
		await sleep(10000)

		// Step 3: Find and kill all task runner containers for THIS run only
		let taskContainerNames: string[] = []

		try {
			const output = execFileSync("docker", ["ps", "--format", "{{.Names}}", "--filter", `name=${taskPattern}`], {
				encoding: "utf-8",
				timeout: 10000,
			})
			taskContainerNames = output
				.split("\n")
				.map((name) => name.trim())
				.filter((name) => name.length > 0 && name.startsWith(taskPattern))
		} catch (error) {
			console.error("Failed to list task containers:", error)
			errors.push("Failed to list Docker task containers")
		}

		// Kill each task runner container
		for (const containerName of taskContainerNames) {
			try {
				execFileSync("docker", ["kill", containerName], { encoding: "utf-8", timeout: 10000 })
				killedContainers.push(containerName)
				console.log(`Killed task container: ${containerName}`)
			} catch (error) {
				// Container might have already stopped
				console.error(`Failed to kill container ${containerName}:`, error)
				errors.push(`Failed to kill container: ${containerName}`)
			}
		}

		// Step 4: Clear Redis state
		try {
			const redis = await redisClient()
			const heartbeatKey = `heartbeat:${runId}`
			const runnersKey = `runners:${runId}`

			await redis.del(heartbeatKey)
			await redis.del(runnersKey)
			console.log(`Cleared Redis keys: ${heartbeatKey}, ${runnersKey}`)
		} catch (error) {
			console.error("Failed to clear Redis state:", error)
			errors.push("Failed to clear Redis state")
		}
	} catch (error) {
		console.error("Error in killRun:", error)
		errors.push("Unexpected error while killing containers")
	}

	revalidatePath(`/runs/${runId}`)
	revalidatePath("/runs")

	return {
		success: killedContainers.length > 0 || errors.length === 0,
		killedContainers,
		errors,
	}
}

export type DeleteIncompleteRunsResult = {
	success: boolean
	deletedCount: number
	deletedRunIds: number[]
	storageErrors: string[]
}

/**
 * Delete all incomplete runs (runs without a taskMetricsId/final score).
 * Removes both database records and storage folders.
 */
export async function deleteIncompleteRuns(): Promise<DeleteIncompleteRunsResult> {
	const storageErrors: string[] = []

	// Get all incomplete runs
	const incompleteRuns = await _getIncompleteRuns()
	const runIds = incompleteRuns.map((run) => run.id)

	if (runIds.length === 0) {
		return {
			success: true,
			deletedCount: 0,
			deletedRunIds: [],
			storageErrors: [],
		}
	}

	// Delete storage folders for each run
	for (const runId of runIds) {
		const storagePath = path.join(EVALS_STORAGE_PATH, String(runId))
		try {
			if (fs.existsSync(storagePath)) {
				fs.rmSync(storagePath, { recursive: true, force: true })
				console.log(`Deleted storage folder: ${storagePath}`)
			}
		} catch (error) {
			console.error(`Failed to delete storage folder ${storagePath}:`, error)
			storageErrors.push(`Failed to delete storage for run ${runId}`)
		}

		// Also try to clear Redis state for any potentially running incomplete runs
		try {
			const redis = await redisClient()
			await redis.del(`heartbeat:${runId}`)
			await redis.del(`runners:${runId}`)
		} catch (error) {
			// Non-critical error, just log it
			console.error(`Failed to clear Redis state for run ${runId}:`, error)
		}
	}

	// Delete from database
	await _deleteRunsByIds(runIds)

	revalidatePath("/runs")

	return {
		success: true,
		deletedCount: runIds.length,
		deletedRunIds: runIds,
		storageErrors,
	}
}

/**
 * Get count of incomplete runs (for UI display)
 */
export async function getIncompleteRunsCount(): Promise<number> {
	const incompleteRuns = await _getIncompleteRuns()
	return incompleteRuns.length
}

/**
 * Delete all runs older than 30 days.
 * Removes both database records and storage folders.
 */
export async function deleteOldRuns(): Promise<DeleteIncompleteRunsResult> {
	const storageErrors: string[] = []

	// Get all runs older than 30 days
	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
	const { getRuns } = await import("@roo-code/evals")
	const allRuns = await getRuns()
	const oldRuns = allRuns.filter((run) => run.createdAt < thirtyDaysAgo)
	const runIds = oldRuns.map((run) => run.id)

	if (runIds.length === 0) {
		return {
			success: true,
			deletedCount: 0,
			deletedRunIds: [],
			storageErrors: [],
		}
	}

	// Delete storage folders for each run
	for (const runId of runIds) {
		const storagePath = path.join(EVALS_STORAGE_PATH, String(runId))
		try {
			if (fs.existsSync(storagePath)) {
				fs.rmSync(storagePath, { recursive: true, force: true })
				console.log(`Deleted storage folder: ${storagePath}`)
			}
		} catch (error) {
			console.error(`Failed to delete storage folder ${storagePath}:`, error)
			storageErrors.push(`Failed to delete storage for run ${runId}`)
		}

		// Also try to clear Redis state
		try {
			const redis = await redisClient()
			await redis.del(`heartbeat:${runId}`)
			await redis.del(`runners:${runId}`)
		} catch (error) {
			// Non-critical error, just log it
			console.error(`Failed to clear Redis state for run ${runId}:`, error)
		}
	}

	// Delete from database
	await _deleteRunsByIds(runIds)

	revalidatePath("/runs")

	return {
		success: true,
		deletedCount: runIds.length,
		deletedRunIds: runIds,
		storageErrors,
	}
}

/**
 * Update the description of a run.
 */
export async function updateRunDescription(runId: number, description: string | null): Promise<{ success: boolean }> {
	try {
		await _updateRun(runId, { description })
		revalidatePath("/runs")
		revalidatePath(`/runs/${runId}`)
		return { success: true }
	} catch (error) {
		console.error("Failed to update run description:", error)
		return { success: false }
	}
}
