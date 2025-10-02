import * as fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"

import { RooCodeAPI, TokenUsage } from "../../src/exports/roo-code"

import { waitUntilReady, waitUntilCompleted, sleep } from "./utils"

interface RunResult {
	run: number
	duration: number
	inputTokens?: number
	outputTokens?: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	totalCost?: number
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms.toFixed(0)}ms`
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
	return `${(ms / 60000).toFixed(1)}m`
}

function printSummary(runs: RunResult[], retryCount: number): void {
	console.log("\n" + "═".repeat(80))
	console.log("\n📊 Benchmark Summary\n")

	const durations = runs.map((r) => r.duration)
	const avgDuration = durations.reduce((sum, d) => sum + d, 0) / retryCount
	const minDuration = Math.min(...durations)
	const maxDuration = Math.max(...durations)

	console.log(`  🔄 Runs: ${retryCount}`)
	console.log(`  ⏱️  Average Time: ${formatDuration(avgDuration)}`)
	console.log(`  ⚡ Min Time: ${formatDuration(minDuration)}`)
	console.log(`  🐢 Max Time: ${formatDuration(maxDuration)}`)

	const avgInputTokens = runs.reduce((sum, r) => sum + (r.inputTokens || 0), 0) / retryCount
	const avgOutputTokens = runs.reduce((sum, r) => sum + (r.outputTokens || 0), 0) / retryCount
	const avgCost = runs.reduce((sum, r) => sum + (r.totalCost || 0), 0) / retryCount

	console.log(`\n  📥 Avg Input Tokens: ${avgInputTokens.toFixed(0)}`)
	console.log(`  📤 Avg Output Tokens: ${avgOutputTokens.toFixed(0)}`)
	console.log(`  💰 Avg Cost: $${avgCost.toFixed(4)}`)

	console.log("\n📋 Individual Runs:")
	runs.forEach((run) => {
		console.log(`  Run ${run.run}: ${formatDuration(run.duration)} (${run.inputTokens || 0} in, ${run.outputTokens || 0} out)`)
	})

	console.log("\n" + "═".repeat(80) + "\n")
}

export async function run() {
	/**
	 * Validate environment variables.
	 */

	const runId = process.env.RUN_ID
	const openRouterApiKey = process.env.OPENROUTER_API_KEY
	const openRouterModelId = process.env.OPENROUTER_MODEL_ID
	const promptPath = process.env.PROMPT_PATH
	const workspacePath = process.env.WORKSPACE_PATH
	const retryCount = parseInt(process.env.RETRY_COUNT || "3")

	if (!runId || !openRouterApiKey || !openRouterModelId || !promptPath || !workspacePath) {
		throw new Error("ENV not configured.")
	}

	const prompt = await fs.readFile(promptPath, "utf-8")

	/**
	 * Activate the extension.
	 */

	const extension = vscode.extensions.getExtension<RooCodeAPI>("kilocode.Kilo-Code")

	if (!extension) {
		throw new Error("Extension not found.")
	}

	const api = extension.isActive ? extension.exports : await extension.activate()

	/**
	 * Wait for the Kilo Code to be ready to accept tasks.
	 */

	await waitUntilReady({ api })

	/**
	 * Configure Kilo Code as needed.
	 *
	 * Use Claude 3.7 Sonnet via OpenRouter.
	 * Don't require approval for anything.
	 * Run any command without approval.
	 * Disable checkpoints (for performance).
	 */

	await api.setConfiguration({
		apiProvider: "openrouter",
		openRouterApiKey,
		openRouterModelId,
		autoApprovalEnabled: true,
		alwaysAllowReadOnly: true,
		alwaysAllowWrite: true,
		alwaysAllowExecute: true,
		alwaysAllowBrowser: true,
		alwaysApproveResubmit: true,
		alwaysAllowMcp: true,
		alwaysAllowModeSwitch: true,
		enableCheckpoints: false,
	})

	await vscode.workspace
		.getConfiguration("kilo-code")
		.update("allowedCommands", ["*"], vscode.ConfigurationTarget.Global)

	await sleep(2_000)

	/**
	 * Run the task multiple times and collect timing/usage data.
	 */

	const runs = []

	for (let i = 0; i < retryCount; i++) {
		const startTime = Date.now()
		const taskId = await api.startNewTask(prompt)

		let usage: TokenUsage | undefined = undefined

		try {
			usage = await waitUntilCompleted({ api, taskId, timeout: 5 * 60 * 1_000 }) // 5m
		} catch (e) {
			usage = api.getTokenUsage(taskId)
		}

		const duration = Date.now() - startTime

		runs.push({
			run: i + 1,
			duration,
			...usage,
		})

		if (i < retryCount - 1) {
			await sleep(2_000)
		}
	}

	/**
	 * Calculate averages across all runs.
	 */

	const totalDuration = runs.reduce((sum, r) => sum + r.duration, 0)
	const totalInputTokens = runs.reduce((sum, r) => sum + (r.inputTokens || 0), 0)
	const totalOutputTokens = runs.reduce((sum, r) => sum + (r.outputTokens || 0), 0)
	const totalCacheWriteTokens = runs.reduce((sum, r) => sum + (r.cacheWriteTokens || 0), 0)
	const totalCacheReadTokens = runs.reduce((sum, r) => sum + (r.cacheReadTokens || 0), 0)
	const totalCost = runs.reduce((sum, r) => sum + (r.totalCost || 0), 0)

	const averages = {
		duration: totalDuration / retryCount,
		inputTokens: totalInputTokens / retryCount,
		outputTokens: totalOutputTokens / retryCount,
		cacheWriteTokens: totalCacheWriteTokens / retryCount,
		cacheReadTokens: totalCacheReadTokens / retryCount,
		totalCost: totalCost / retryCount,
	}

	printSummary(runs, retryCount)

	const content = JSON.stringify(
		{
			runId: parseInt(runId),
			retryCount,
			runs,
			averages,
		},
		null,
		2,
	)

	await fs.writeFile(path.resolve(workspacePath, "usage.json"), content)
}
