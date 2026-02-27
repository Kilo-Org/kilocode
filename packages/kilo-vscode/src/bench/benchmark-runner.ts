import { BenchCreditError } from "./types.js"
import type { BenchApiHandler, BenchProblem, BenchRawResponse } from "./types.js"
import type { WorkspaceIsolator } from "./workspace-isolator.js"

export type RunnerProgressCallback = (update: {
	currentModel: string
	currentProblem: number
	totalProblems: number
	message: string
}) => void

export type RunnerResultCallback = (result: BenchRawResponse) => void | Promise<void>

/** System prompts for text-only mode (no tool access) */
const TEXT_SYSTEM_PROMPTS: Record<string, string> = {
	architect:
		"You are a software architect. Analyze the request and provide a detailed architectural plan. Do not write implementation code — focus on design, patterns, trade-offs, and structure.",
	code: "You are a senior software engineer. Describe how you would implement the requested feature or change with clean, idiomatic, production-quality code. Follow existing project patterns and conventions.",
	debug: "You are a debugging expert. Diagnose the described issue, identify the root cause, and describe the targeted fix. Explain your reasoning step by step.",
	ask: "You are a knowledgeable codebase expert. Provide a clear, thorough explanation addressing the question. Reference specific files, modules, and data flows where relevant.",
	orchestrator:
		"You are a task orchestrator. Break the complex request into well-defined subtasks, assign each to the appropriate mode, and outline the execution order and dependencies.",
}

/** System prompts for execution mode (full tool access in isolated workspace) */
const EXEC_SYSTEM_PROMPTS: Record<string, string> = {
	architect:
		"You are a software architect. Analyze the request and provide a detailed architectural plan. Focus on design, patterns, trade-offs, and structure.",
	code: "You are a senior software engineer. Implement the requested feature or change by actually creating or modifying files. Write clean, idiomatic, production-quality code that follows existing project patterns.",
	debug: "You are a debugging expert. Diagnose the described issue, identify the root cause, and apply the fix by modifying the relevant files. Explain your reasoning.",
	ask: "You are a knowledgeable codebase expert. Provide a clear, thorough explanation addressing the question. Reference specific files, modules, and data flows where relevant.",
	orchestrator:
		"You are a task orchestrator. Break the complex request into well-defined subtasks, assign each to the appropriate mode, and outline the execution order and dependencies.",
}

/**
 * Run all problems for a single model, optionally capturing diffs and resetting
 * the workspace between problems via the provided isolator.
 */
export async function runModelBenchmark(
	problems: BenchProblem[],
	modelId: string,
	apiHandler: BenchApiHandler,
	isolator: WorkspaceIsolator | null,
	onProgress: RunnerProgressCallback,
	abortSignal?: AbortSignal,
	onResult?: RunnerResultCallback,
): Promise<BenchRawResponse[]> {
	const results: BenchRawResponse[] = []
	const prompts = isolator ? EXEC_SYSTEM_PROMPTS : TEXT_SYSTEM_PROMPTS

	for (let pi = 0; pi < problems.length; pi++) {
		if (abortSignal?.aborted) {
			throw new Error("Benchmark cancelled")
		}

		const problem = problems[pi]

		onProgress({
			currentModel: modelId,
			currentProblem: pi + 1,
			totalProblems: problems.length,
			message: `[${modelId}] Running problem ${pi + 1}/${problems.length}: ${problem.title}`,
		})

		const result = await runSingleProblem(modelId, problem, apiHandler, prompts, abortSignal)

		// Capture diff and reset workspace between problems
		if (isolator) {
			try {
				result.diff = await isolator.captureDiff()
			} catch (err) {
				result.diff = `(diff capture failed: ${err instanceof Error ? err.message : String(err)})`
			}
			try {
				await isolator.reset()
			} catch (err) {
				console.warn(`[Kilo Bench] Workspace reset failed: ${err}`)
			}
		}

		results.push(result)
		await onResult?.(result)
	}

	return results
}

async function runSingleProblem(
	modelId: string,
	problem: BenchProblem,
	apiHandler: BenchApiHandler,
	systemPrompts: Record<string, string>,
	abortSignal?: AbortSignal,
): Promise<BenchRawResponse> {
	const startTime = Date.now()
	let ttft = 0
	let responseText = ""
	let inputTokens = 0
	let outputTokens = 0
	let cost = 0
	let firstChunkReceived = false

	try {
		const systemPrompt = systemPrompts[problem.mode] || systemPrompts.code
		const stream = apiHandler.createMessage(systemPrompt, problem.prompt, modelId)

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
		if (abortSignal?.aborted || error instanceof BenchCreditError) {
			throw error
		}
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
