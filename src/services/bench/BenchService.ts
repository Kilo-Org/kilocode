// kilocode_change - new file
import type { ProviderSettings } from "@roo-code/types"

import { runBenchmark } from "../../core/bench/benchmark-runner"
import { evaluateAllResponses } from "../../core/bench/evaluator"
import { generateProblems } from "../../core/bench/problem-generator"
import { buildEvaluation, calculateAggregateScore, calculateModeScores } from "../../core/bench/score-calculator"
import * as storage from "../../core/bench/storage"
import type {
	BenchConfig,
	BenchProblemSet,
	BenchProgress,
	BenchRawResponse,
	BenchRunResult,
} from "../../core/bench/types"
import { DEFAULT_BENCH_CONFIG } from "../../core/bench/types"

export type ProgressCallback = (progress: BenchProgress) => void

export class BenchService {
	private cwd: string
	private providerSettings: ProviderSettings
	private abortController: AbortController | null = null

	constructor(cwd: string, providerSettings: ProviderSettings) {
		this.cwd = cwd
		this.providerSettings = providerSettings
	}

	async loadConfig(): Promise<BenchConfig> {
		return storage.loadConfig(this.cwd)
	}

	async saveConfig(config: BenchConfig): Promise<void> {
		await storage.saveConfig(this.cwd, config)
	}

	async loadLatestResult(): Promise<BenchRunResult | null> {
		return storage.loadLatestResult(this.cwd)
	}

	async loadAllResults(): Promise<BenchRunResult[]> {
		return storage.loadAllResults(this.cwd)
	}

	async generate(onProgress: ProgressCallback): Promise<BenchProblemSet> {
		this.abortController = new AbortController()

		onProgress({
			phase: "generating",
			message: "Analyzing workspace and generating problems...",
		})

		const config = await this.loadConfig()
		const resolvedConfig: BenchConfig = {
			...DEFAULT_BENCH_CONFIG,
			...config,
			generatorModel: config.generatorModel || "",
			evaluatorModel: config.evaluatorModel || "",
		}

		const problems = await generateProblems(
			this.cwd,
			resolvedConfig,
			this.providerSettings,
			this.abortController.signal,
		)

		await storage.saveProblems(this.cwd, problems)

		onProgress({
			phase: "generating",
			message: `Generated ${problems.problems.length} problems`,
		})

		return problems
	}

	async startBenchmark(models: string[], onProgress: ProgressCallback): Promise<BenchRunResult> {
		this.abortController = new AbortController()

		// Phase 1: Generate problems
		const problems = await this.generate(onProgress)
		const config = await this.loadConfig()

		// Phase 2: Run benchmark
		onProgress({
			phase: "running",
			totalModels: models.length,
			modelsCompleted: 0,
			totalProblems: problems.problems.length,
			currentProblem: 0,
			message: "Starting benchmark run...",
		})

		const rawResponses: BenchRawResponse[] = await runBenchmark(
			problems.problems,
			models,
			config,
			this.providerSettings,
			(update) => {
				onProgress({
					phase: "running",
					currentModel: update.currentModel,
					currentProblem: update.currentProblem,
					totalProblems: update.totalProblems,
					modelsCompleted: update.modelsCompleted,
					totalModels: update.totalModels,
					message: update.message,
				})
			},
			this.abortController.signal,
		)

		// Phase 3: Evaluate responses with AI judge
		onProgress({
			phase: "evaluating",
			message: "Evaluating responses with AI judge...",
		})

		const evaluations = await evaluateAllResponses(
			problems.problems,
			rawResponses,
			this.providerSettings,
			(evaluated, total) => {
				onProgress({
					phase: "evaluating",
					message: `Evaluating response ${evaluated}/${total}...`,
				})
			},
			this.abortController.signal,
		)

		// Phase 4: Score and build results
		const result: BenchRunResult = {
			id: Date.now().toString(36),
			runAt: new Date().toISOString(),
			problemSet: problems,
			models,
			config,
			results: models.map((modelId) => {
				const modelResponses = rawResponses.filter((r) => r.modelId === modelId)
				const problemResults = modelResponses.map((r) => {
					const evalKey = `${r.modelId}::${r.problemId}`
					const aiEval = evaluations.get(evalKey) || {
						qualityScore: 0,
						relevanceScore: 0,
						qualityRationale: "No evaluation available",
						relevanceRationale: "No evaluation available",
					}
					const evaluation = buildEvaluation(r, aiEval, config.weights || DEFAULT_BENCH_CONFIG.weights)
					return {
						problemId: r.problemId,
						mode: r.mode,
						responseContent: r.responseContent,
						ttft: r.ttft,
						totalTime: r.totalTime,
						inputTokens: r.inputTokens,
						outputTokens: r.outputTokens,
						cost: r.cost,
						evaluation,
					}
				})

				const evaluationsList = problemResults.map((p) => p.evaluation)

				return {
					modelId,
					modelName: modelId,
					problems: problemResults,
					aggregateScore: calculateAggregateScore(evaluationsList),
					modeScores: calculateModeScores(problemResults),
					totalCost: modelResponses.reduce((sum, r) => sum + r.cost, 0),
					totalInputTokens: modelResponses.reduce((sum, r) => sum + r.inputTokens, 0),
					totalOutputTokens: modelResponses.reduce((sum, r) => sum + r.outputTokens, 0),
					totalTime: modelResponses.reduce((sum, r) => sum + r.totalTime, 0),
				}
			}),
		}

		await storage.saveRunResult(this.cwd, result)

		onProgress({ phase: "complete", message: "Benchmark complete" })

		return result
	}

	cancel(): void {
		this.abortController?.abort()
		this.abortController = null
	}
}
