// kilocode_change - new file
import type { ProviderSettings } from "@roo-code/types"

import { buildApiHandler } from "../../api"
import type { BenchEvaluation, BenchProblem, BenchRawResponse } from "./types"

function buildEvaluationPrompt(problem: BenchProblem, response: string): string {
	return `You are an expert AI evaluator judging the quality of a coding assistant's response.

## Problem
**Mode:** ${problem.mode}
**Title:** ${problem.title}
**Prompt:** ${problem.prompt}
**Difficulty:** ${problem.difficulty}

## Evaluation Criteria
The response should address these specific criteria:
${problem.evaluationCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

## Response to Evaluate
${response.slice(0, 8000)}

## Instructions
Score this response on two dimensions:
1. **Quality** (1-10): How well-written, accurate, and complete is the response? Does it follow best practices?
2. **Relevance** (1-10): How well does it address the specific problem and meet the evaluation criteria?

Respond ONLY with valid JSON:
{
  "qualityScore": <1-10>,
  "relevanceScore": <1-10>,
  "qualityRationale": "<1-2 sentence explanation>",
  "relevanceRationale": "<1-2 sentence explanation>"
}`
}

export async function evaluateResponse(
	problem: BenchProblem,
	rawResponse: BenchRawResponse,
	providerSettings: ProviderSettings,
	abortSignal?: AbortSignal,
): Promise<{ qualityScore: number; relevanceScore: number; qualityRationale: string; relevanceRationale: string }> {
	// If the response is an error, return zero scores
	if (rawResponse.responseContent.startsWith("[ERROR]")) {
		return {
			qualityScore: 0,
			relevanceScore: 0,
			qualityRationale: "Response was an error",
			relevanceRationale: "Response was an error",
		}
	}

	const handler = buildApiHandler(providerSettings)
	const prompt = buildEvaluationPrompt(problem, rawResponse.responseContent)
	const messages: { role: "user"; content: string }[] = [{ role: "user", content: prompt }]

	const stream = handler.createMessage("You are an evaluation judge. Output only valid JSON.", messages)

	let responseText = ""
	for await (const chunk of stream) {
		if (abortSignal?.aborted) {
			throw new Error("Evaluation cancelled")
		}
		if (chunk.type === "text") {
			responseText += chunk.text
		}
	}

	// Parse the JSON response
	const jsonMatch = responseText.match(/\{[\s\S]*\}/)
	if (!jsonMatch) {
		return {
			qualityScore: 5,
			relevanceScore: 5,
			qualityRationale: "Evaluator did not return valid JSON",
			relevanceRationale: "Evaluator did not return valid JSON",
		}
	}

	try {
		const parsed = JSON.parse(jsonMatch[0])
		return {
			qualityScore: Math.max(0, Math.min(10, Number(parsed.qualityScore) || 5)),
			relevanceScore: Math.max(0, Math.min(10, Number(parsed.relevanceScore) || 5)),
			qualityRationale: String(parsed.qualityRationale || ""),
			relevanceRationale: String(parsed.relevanceRationale || ""),
		}
	} catch {
		return {
			qualityScore: 5,
			relevanceScore: 5,
			qualityRationale: "Failed to parse evaluator response",
			relevanceRationale: "Failed to parse evaluator response",
		}
	}
}

export async function evaluateAllResponses(
	problems: BenchProblem[],
	rawResponses: BenchRawResponse[],
	providerSettings: ProviderSettings,
	onProgress: (evaluated: number, total: number) => void,
	abortSignal?: AbortSignal,
): Promise<
	Map<string, { qualityScore: number; relevanceScore: number; qualityRationale: string; relevanceRationale: string }>
> {
	const evaluations = new Map<
		string,
		{ qualityScore: number; relevanceScore: number; qualityRationale: string; relevanceRationale: string }
	>()
	const problemMap = new Map(problems.map((p) => [p.id, p]))

	for (let i = 0; i < rawResponses.length; i++) {
		if (abortSignal?.aborted) {
			throw new Error("Evaluation cancelled")
		}

		const raw = rawResponses[i]
		const problem = problemMap.get(raw.problemId)
		if (!problem) continue

		const evalResult = await evaluateResponse(problem, raw, providerSettings, abortSignal)
		// Key by modelId + problemId to uniquely identify each evaluation
		evaluations.set(`${raw.modelId}::${raw.problemId}`, evalResult)
		onProgress(i + 1, rawResponses.length)
	}

	return evaluations
}
