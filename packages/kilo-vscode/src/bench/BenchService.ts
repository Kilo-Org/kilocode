import type { KiloConnectionService } from "../services/cli-backend/index.js"
import { createBenchApiHandler } from "./bench-api-adapter.js"
import { runModelBenchmark } from "./benchmark-runner.js"
import { evaluateAllResponses } from "./evaluator.js"
import { generateProblems } from "./problem-generator.js"
import { buildEvaluation, calculateAggregateScore, calculateModeScores } from "./score-calculator.js"
import * as storage from "./storage.js"
import {
	BenchCreditError,
	DEFAULT_BENCH_CONFIG,
} from "./types.js"
import type {
	BenchApiHandler,
	BenchCheckpoint,
	BenchConfig,
	BenchProblemSet,
	BenchProgress,
	BenchRawResponse,
	BenchRunResult,
} from "./types.js"
import { createWorkspaceIsolator, type WorkspaceIsolator } from "./workspace-isolator.js"

export type ProgressCallback = (progress: BenchProgress) => void

export class BenchService {
	private cwd: string
	private apiHandler: BenchApiHandler
	private connectionService: KiloConnectionService
	private defaultProviderId: string
	private abortController: AbortController | null = null

	constructor(
		cwd: string,
		apiHandler: BenchApiHandler,
		connectionService: KiloConnectionService,
		defaultProviderId: string,
	) {
		this.cwd = cwd
		this.apiHandler = apiHandler
		this.connectionService = connectionService
		this.defaultProviderId = defaultProviderId
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

	async loadCheckpoint(): Promise<BenchCheckpoint | null> {
		return storage.loadCheckpoint(this.cwd)
	}

	async generate(onProgress: ProgressCallback): Promise<BenchProblemSet> {
		this.abortController = new AbortController()

		onProgress({
			phase: "generating",
			message: "Analyzing workspace and generating problems...",
		})

		const config = await this.loadConfig()

		const problems = await generateProblems(
			this.cwd,
			config,
			this.apiHandler,
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
		const runId = Date.now().toString(36)

		// Phase 1: Generate problems
		const problems = await this.generate(onProgress)
		const config = await this.loadConfig()

		return this.runFromPhase(runId, models, problems, config, [], {}, onProgress)
	}

	async resumeBenchmark(onProgress: ProgressCallback): Promise<BenchRunResult> {
		const checkpoint = await storage.loadCheckpoint(this.cwd)
		if (!checkpoint) {
			throw new Error("No checkpoint found to resume from")
		}

		this.abortController = new AbortController()

		onProgress({
			phase: checkpoint.phase,
			message: `Resuming benchmark from ${checkpoint.phase} phase...`,
		})

		return this.runFromPhase(
			checkpoint.runId,
			checkpoint.models,
			checkpoint.problemSet,
			checkpoint.config,
			checkpoint.completedResponses,
			checkpoint.completedEvaluations,
			onProgress,
		)
	}

	private async runFromPhase(
		runId: string,
		models: string[],
		problems: BenchProblemSet,
		config: BenchConfig,
		existingResponses: BenchRawResponse[],
		existingEvaluations: Record<string, { qualityScore: number; relevanceScore: number; qualityRationale: string; relevanceRationale: string }>,
		onProgress: ProgressCallback,
	): Promise<BenchRunResult> {
		let rawResponses = [...existingResponses]
		const evaluations = new Map(Object.entries(existingEvaluations))

		// Figure out what's already done
		const completedKeys = new Set(rawResponses.map((r) => `${r.modelId}::${r.problemId}`))
		const totalExpected = models.length * problems.problems.length
		const needsRunning = totalExpected > completedKeys.size

		// Phase 2: Run benchmark with isolated workspaces per model
		if (needsRunning) {
			onProgress({
				phase: "running",
				totalModels: models.length,
				modelsCompleted: 0,
				totalProblems: problems.problems.length,
				currentProblem: 0,
				message: existingResponses.length > 0
					? `Resuming... ${existingResponses.length}/${totalExpected} already complete`
					: "Starting benchmark run...",
			})

			let modelsCompleted = 0

			for (const modelId of models) {
				if (this.abortController?.signal.aborted) {
					throw new Error("Benchmark cancelled")
				}

				// Filter to unsolved problems for this model
				const modelProblems = problems.problems.filter(
					(p) => !completedKeys.has(`${modelId}::${p.id}`),
				)
				if (modelProblems.length === 0) {
					modelsCompleted++
					continue
				}

				// Create isolated workspace for this model
				let isolator: WorkspaceIsolator | null = null
				let execHandler: BenchApiHandler = this.apiHandler

				try {
					onProgress({
						phase: "running",
						currentModel: modelId,
						totalModels: models.length,
						modelsCompleted,
						message: `Creating isolated workspace for ${modelId}...`,
					})

					isolator = await createWorkspaceIsolator(this.cwd, modelId, console.log)

					// Create an execution-mode handler pointed at the isolated directory
					execHandler = createBenchApiHandler(
						this.connectionService,
						isolator.isolatedDir,
						modelId,
						this.defaultProviderId,
						{ textOnly: false },
					)

					console.log(`[Kilo Bench] Isolation ready for ${modelId}: ${isolator.strategy} → ${isolator.isolatedDir}`)
				} catch (err) {
					console.warn(`[Kilo Bench] Failed to create isolation for ${modelId}, falling back to text-only: ${err}`)
					// isolator stays null, execHandler stays as text-only apiHandler
				}

				try {
					await runModelBenchmark(
						modelProblems,
						modelId,
						execHandler,
						isolator,
						(update) => {
							onProgress({
								phase: "running",
								currentModel: update.currentModel,
								currentProblem: update.currentProblem,
								totalProblems: update.totalProblems,
								modelsCompleted,
								totalModels: models.length,
								message: update.message,
							})
						},
						this.abortController!.signal,
						(result) => {
							rawResponses.push(result)
							completedKeys.add(`${result.modelId}::${result.problemId}`)
							return this.saveCheckpointQuietly(runId, models, problems, config, rawResponses, evaluations, "running")
						},
					)
				} catch (error) {
					if (error instanceof BenchCreditError || (this.abortController && !this.abortController.signal.aborted)) {
						await this.saveCheckpointQuietly(
							runId, models, problems, config, rawResponses, evaluations, "running",
							error instanceof BenchCreditError ? error.message : (error instanceof Error ? error.message : "Unknown error"),
						)
					}
					throw error
				} finally {
					// Clean up isolation for this model
					if (isolator) {
						try {
							await isolator.cleanup()
						} catch (err) {
							console.warn(`[Kilo Bench] Isolation cleanup failed for ${modelId}: ${err}`)
						}
					}
				}

				modelsCompleted++
			}
		}

		// Save checkpoint at transition to eval phase
		await this.saveCheckpointQuietly(runId, models, problems, config, rawResponses, evaluations, "evaluating")

		// Phase 3: Evaluate (skip already-evaluated pairs)
		onProgress({
			phase: "evaluating",
			message: evaluations.size > 0
				? `Resuming evaluation... ${evaluations.size} already evaluated`
				: "Evaluating responses with AI judge...",
		})

		const unevaluatedResponses = rawResponses.filter((r) => !evaluations.has(`${r.modelId}::${r.problemId}`))

		try {
			const newEvaluations = await evaluateAllResponses(
				problems.problems,
				unevaluatedResponses,
				this.apiHandler,
				(evaluated, total) => {
					const totalEvaluated = evaluations.size + evaluated
					const totalToEval = evaluations.size + total
					onProgress({
						phase: "evaluating",
						message: `Evaluating response ${totalEvaluated}/${totalToEval}...`,
					})

					// Checkpoint during evaluation too
					void this.saveCheckpointQuietly(runId, models, problems, config, rawResponses, evaluations, "evaluating")
				},
				this.abortController!.signal,
			)

			// Merge new evaluations
			for (const [key, val] of newEvaluations) {
				evaluations.set(key, val)
			}
		} catch (error) {
			if (error instanceof BenchCreditError || (this.abortController && !this.abortController.signal.aborted)) {
				await this.saveCheckpointQuietly(
					runId, models, problems, config, rawResponses, evaluations, "evaluating",
					error instanceof BenchCreditError ? error.message : (error instanceof Error ? error.message : "Unknown error"),
				)
			}
			throw error
		}

		// Phase 4: Score and build results
		const result: BenchRunResult = {
			id: runId,
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
		// Clear checkpoint on successful completion
		await storage.clearCheckpoint(this.cwd)

		onProgress({ phase: "complete", message: "Benchmark complete" })

		return result
	}

	private async saveCheckpointQuietly(
		runId: string,
		models: string[],
		problemSet: BenchProblemSet,
		config: BenchConfig,
		responses: BenchRawResponse[],
		evaluations: Map<string, { qualityScore: number; relevanceScore: number; qualityRationale: string; relevanceRationale: string }>,
		phase: "running" | "evaluating",
		interruptReason?: string,
	): Promise<void> {
		try {
			await storage.saveCheckpoint(this.cwd, {
				runId,
				startedAt: new Date().toISOString(),
				models,
				problemSet,
				config,
				phase,
				completedResponses: responses,
				completedEvaluations: Object.fromEntries(evaluations),
				interruptReason: interruptReason || "",
			})
		} catch {
			// Best-effort checkpointing
		}
	}

	cancel(): void {
		this.abortController?.abort()
		this.abortController = null
	}
}
