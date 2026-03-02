import type { BenchConfig, BenchEvaluation, BenchRawResponse } from "./types.js"

function calculateSpeedScore(ttftMs: number): number {
	if (ttftMs <= 0) return 10
	const score = 10 - Math.log2(ttftMs / 200) * 1.5
	return Math.max(0, Math.min(10, score))
}

function calculateCostScore(costUsd: number): number {
	if (costUsd <= 0) return 10
	const score = 10 - Math.log10(costUsd / 0.001) * 3
	return Math.max(0, Math.min(10, score))
}

function calculateCompositeScore(
	qualityScore: number,
	relevanceScore: number,
	speedScore: number,
	costScore: number,
	weights: BenchConfig["weights"],
): number {
	const totalWeight = weights.quality + weights.relevance + weights.speed + weights.cost
	if (totalWeight === 0) return 0

	return (
		(qualityScore * weights.quality +
			relevanceScore * weights.relevance +
			speedScore * weights.speed +
			costScore * weights.cost) /
		totalWeight
	)
}

export function buildEvaluation(
	raw: BenchRawResponse,
	aiEval: { qualityScore: number; relevanceScore: number; qualityRationale: string; relevanceRationale: string },
	weights: BenchConfig["weights"],
): BenchEvaluation {
	const speedScore = calculateSpeedScore(raw.ttft)
	const costScore = calculateCostScore(raw.cost)
	const compositeScore = calculateCompositeScore(
		aiEval.qualityScore,
		aiEval.relevanceScore,
		speedScore,
		costScore,
		weights,
	)

	return {
		qualityScore: aiEval.qualityScore,
		relevanceScore: aiEval.relevanceScore,
		qualityRationale: aiEval.qualityRationale,
		relevanceRationale: aiEval.relevanceRationale,
		speedScore: Math.round(speedScore * 100) / 100,
		costScore: Math.round(costScore * 100) / 100,
		compositeScore: Math.round(compositeScore * 100) / 100,
	}
}

export function calculateAggregateScore(evaluations: BenchEvaluation[]): number {
	if (evaluations.length === 0) return 0
	const sum = evaluations.reduce((acc, e) => acc + e.compositeScore, 0)
	return Math.round((sum / evaluations.length) * 100) / 100
}

export function calculateModeScores(results: { mode: string; evaluation: BenchEvaluation }[]): Record<string, number> {
	const modeGroups: Record<string, BenchEvaluation[]> = {}
	for (const r of results) {
		if (!modeGroups[r.mode]) {
			modeGroups[r.mode] = []
		}
		modeGroups[r.mode].push(r.evaluation)
	}

	const scores: Record<string, number> = {}
	for (const [mode, evals] of Object.entries(modeGroups)) {
		scores[mode] = calculateAggregateScore(evals)
	}
	return scores
}
