import { BenchCreditError } from "./types.js"
import type { BenchApiHandler, BenchProblem, BenchRawResponse } from "./types.js"

function extractEvalJSON(text: string): any | null {
	const stripped = text.replace(/^```(?:json)?\s*\n?/gm, "").replace(/\n?```\s*$/gm, "").trim()
	try {
		const p = JSON.parse(stripped)
		if (p && typeof p === "object") return p
	} catch { /* continue */ }
	const match = stripped.match(/\{[\s\S]*\}/)
	if (match) {
		try { return JSON.parse(match[0]) } catch { /* continue */ }
	}
	const i = text.indexOf("{")
	if (i >= 0) {
		const c = text.slice(i)
		const j = c.lastIndexOf("}")
		if (j > 0) {
			try { return JSON.parse(c.slice(0, j + 1)) } catch { /* give up */ }
		}
	}
	return null
}

function buildEvaluationPrompt(problem: BenchProblem, response: string, diff?: string): string {
	const hasDiff = diff && diff !== "(no changes detected)"

	let prompt = `You are an expert AI evaluator judging the quality of a coding assistant's response.

## Problem
**Mode:** ${problem.mode}
**Title:** ${problem.title}
**Prompt:** ${problem.prompt}
**Difficulty:** ${problem.difficulty}

## Evaluation Criteria
The response should address these specific criteria:
${problem.evaluationCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

## Response to Evaluate
${response.slice(0, 8000)}`

	if (hasDiff) {
		prompt += `

## Code Changes (git diff)
The model was given an isolated copy of the workspace and produced the following file changes:
\`\`\`diff
${diff!.slice(0, 6000)}
\`\`\`

When evaluating, consider both the textual response AND the actual code changes.
A model that produced correct, working code changes should score higher than one that only described what to do.`
	}

	prompt += `

## Instructions
Score this response on two dimensions:
1. **Quality** (1-10): How well-written, accurate, and complete is the response? Does it follow best practices?${hasDiff ? " Do the code changes actually implement what was requested?" : ""}
2. **Relevance** (1-10): How well does it address the specific problem and meet the evaluation criteria?${hasDiff ? " Are the code changes relevant and correct?" : ""}

Respond ONLY with valid JSON:
{
  "qualityScore": <1-10>,
  "relevanceScore": <1-10>,
  "qualityRationale": "<1-2 sentence explanation>",
  "relevanceRationale": "<1-2 sentence explanation>"
}`

	return prompt
}

export async function evaluateResponse(
	problem: BenchProblem,
	rawResponse: BenchRawResponse,
	apiHandler: BenchApiHandler,
	abortSignal?: AbortSignal,
): Promise<{ qualityScore: number; relevanceScore: number; qualityRationale: string; relevanceRationale: string }> {
	if (rawResponse.responseContent.startsWith("[ERROR]")) {
		return {
			qualityScore: 0,
			relevanceScore: 0,
			qualityRationale: "Response was an error",
			relevanceRationale: "Response was an error",
		}
	}

	try {
		const prompt = buildEvaluationPrompt(problem, rawResponse.responseContent, rawResponse.diff)
		const stream = apiHandler.createMessage("You are an evaluation judge. Output only valid JSON.", prompt)

		let responseText = ""
		for await (const chunk of stream) {
			if (abortSignal?.aborted) {
				throw new Error("Evaluation cancelled")
			}
			if (chunk.type === "text") {
				responseText += chunk.text
			}
		}

		const parsed = extractEvalJSON(responseText)
		if (!parsed) {
			return {
				qualityScore: 5,
				relevanceScore: 5,
				qualityRationale: "Evaluator did not return valid JSON",
				relevanceRationale: "Evaluator did not return valid JSON",
			}
		}
		return {
			qualityScore: Math.max(0, Math.min(10, Number(parsed.qualityScore) || 5)),
			relevanceScore: Math.max(0, Math.min(10, Number(parsed.relevanceScore) || 5)),
			qualityRationale: String(parsed.qualityRationale || ""),
			relevanceRationale: String(parsed.relevanceRationale || ""),
		}
	} catch (error) {
		if (abortSignal?.aborted || error instanceof BenchCreditError) {
			throw error
		}
		return {
			qualityScore: 5,
			relevanceScore: 5,
			qualityRationale: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
			relevanceRationale: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

export async function evaluateAllResponses(
	problems: BenchProblem[],
	rawResponses: BenchRawResponse[],
	apiHandler: BenchApiHandler,
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

		try {
			const evalResult = await evaluateResponse(problem, raw, apiHandler, abortSignal)
			evaluations.set(`${raw.modelId}::${raw.problemId}`, evalResult)
		} catch (error) {
			if (abortSignal?.aborted || error instanceof BenchCreditError) {
				throw error
			}
			evaluations.set(`${raw.modelId}::${raw.problemId}`, {
				qualityScore: 0,
				relevanceScore: 0,
				qualityRationale: `Evaluation error: ${error instanceof Error ? error.message : String(error)}`,
				relevanceRationale: `Evaluation error: ${error instanceof Error ? error.message : String(error)}`,
			})
		}
		onProgress(i + 1, rawResponses.length)
	}

	return evaluations
}
