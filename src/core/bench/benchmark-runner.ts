// kilocode_change - new file
import type { ProviderSettings } from "@roo-code/types"

import { buildApiHandler } from "../../api"
import type { BenchConfig, BenchProblem, BenchRawResponse } from "./types"

export type RunnerProgressCallback = (update: {
	currentModel: string
	currentProblem: number
	totalProblems: number
	modelsCompleted: number
	totalModels: number
	message: string
}) => void

const MODE_SYSTEM_PROMPTS: Record<string, string> = {
	architect:
		"You are a software architect. Analyze the request and provide a detailed architectural plan. Do not write implementation code — focus on design, patterns, trade-offs, and structure.",
	code: "You are a senior software engineer. Implement the requested feature or change with clean, idiomatic, production-quality code. Follow existing project patterns and conventions.",
	debug: "You are a debugging expert. Diagnose the described issue, identify the root cause, and provide a targeted fix. Explain your reasoning step by step.",
	ask: "You are a knowledgeable codebase expert. Provide a clear, thorough explanation addressing the question. Reference specific files, modules, and data flows where relevant.",
	orchestrator:
		"You are a task orchestrator. Break the complex request into well-defined subtasks, assign each to the appropriate mode, and outline the execution order and dependencies.",
}

function buildProviderSettingsForModel(base: ProviderSettings, modelId: string): ProviderSettings {
	return {
		...base,
		apiModelId: modelId,
		// Override provider-specific model fields so the handler picks up the right model
		openRouterModelId: modelId,
		kilocodeModel: modelId,
	}
}

export async function runBenchmark(
	problems: BenchProblem[],
	models: string[],
	config: BenchConfig,
	providerSettings: ProviderSettings,
	onProgress: RunnerProgressCallback,
	abortSignal?: AbortSignal,
): Promise<BenchRawResponse[]> {
	const results: BenchRawResponse[] = []

	for (let mi = 0; mi < models.length; mi++) {
		const modelId = models[mi]

		for (let pi = 0; pi < problems.length; pi++) {
			if (abortSignal?.aborted) {
				throw new Error("Benchmark cancelled")
			}

			const problem = problems[pi]

			onProgress({
				currentModel: modelId,
				currentProblem: pi + 1,
				totalProblems: problems.length,
				modelsCompleted: mi,
				totalModels: models.length,
				message: `[${modelId}] Running problem ${pi + 1}/${problems.length}: ${problem.title}`,
			})

			const result = await runSingleProblem(modelId, problem, config, providerSettings, abortSignal)
			results.push(result)
		}
	}

	return results
}

async function runSingleProblem(
	modelId: string,
	problem: BenchProblem,
	_config: BenchConfig,
	providerSettings: ProviderSettings,
	abortSignal?: AbortSignal,
): Promise<BenchRawResponse> {
	const settings = buildProviderSettingsForModel(providerSettings, modelId)
	const handler = buildApiHandler(settings)

	const systemPrompt = MODE_SYSTEM_PROMPTS[problem.mode] || MODE_SYSTEM_PROMPTS.code
	const messages: { role: "user"; content: string }[] = [{ role: "user", content: problem.prompt }]

	const startTime = Date.now()
	let ttft = 0
	let responseText = ""
	let inputTokens = 0
	let outputTokens = 0
	let cost = 0
	let firstChunkReceived = false

	try {
		const stream = handler.createMessage(systemPrompt, messages)

		for await (const chunk of stream) {
			if (abortSignal?.aborted) {
				throw new Error("Benchmark cancelled")
			}

			if (chunk.type === "text") {
				if (!firstChunkReceived) {
					ttft = Date.now() - startTime
					firstChunkReceived = true
				}
				responseText += chunk.text
			} else if (chunk.type === "usage") {
				inputTokens = chunk.inputTokens
				outputTokens = chunk.outputTokens
				cost = chunk.totalCost ?? 0
			}
		}
	} catch (error) {
		// If it's a cancellation, re-throw
		if (abortSignal?.aborted) {
			throw error
		}
		// Otherwise record the error as the response
		responseText = `[ERROR] ${error instanceof Error ? error.message : String(error)}`
	}

	const totalTime = Date.now() - startTime

	return {
		modelId,
		problemId: problem.id,
		mode: problem.mode,
		responseContent: responseText,
		ttft,
		totalTime,
		inputTokens,
		outputTokens,
		cost,
	}
}
