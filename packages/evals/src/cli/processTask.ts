import { execa } from "execa"

import { type TaskEvent, RooCodeEventName } from "@roo-code/types"

import { findRun, findTask, updateTask } from "../db/index.js"

import { Logger, getTag, isDockerContainer } from "./utils.js"
import { redisClient, getPubSubKey, registerRunner, deregisterRunner } from "./redis.js"
import { runUnitTest } from "./runUnitTest.js"
import { runTaskWithCli } from "./runTaskInCli.js"
import { runTaskInVscode } from "./runTaskInVscode.js"

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

		const executionMethod = run.executionMethod || "vscode"
		logger.info(`running task ${task.id} (${language}/${exercise}) via ${executionMethod}...`)

		if (executionMethod === "cli") {
			await runTaskWithCli({ run, task, jobToken, publish, logger })
		} else {
			await runTaskInVscode({ run, task, jobToken, publish, logger })
		}

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

	// Pass API keys to the container so the CLI can authenticate
	const apiKeyEnvVars = [
		"OPENROUTER_API_KEY",
		"ANTHROPIC_API_KEY",
		"OPENAI_API_KEY",
		"GOOGLE_API_KEY",
		"DEEPSEEK_API_KEY",
		"MISTRAL_API_KEY",
	]

	for (const envVar of apiKeyEnvVars) {
		if (process.env[envVar]) {
			baseArgs.push(`-e ${envVar}=${process.env[envVar]}`)
		}
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
