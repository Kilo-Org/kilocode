export type BenchMode = "architect" | "code" | "debug" | "ask" | "orchestrator"

export const BENCH_MODES: BenchMode[] = ["architect", "code", "debug", "ask", "orchestrator"]

export interface BenchProblemSet {
	version: string
	generatedAt: string
	generatorModel: string
	workspacePath: string
	workspaceSummary: string
	problems: BenchProblem[]
}

export interface BenchProblem {
	id: string
	mode: BenchMode
	title: string
	prompt: string
	contextFiles: string[]
	evaluationCriteria: string[]
	difficulty: "easy" | "medium" | "hard"
}

export interface BenchRunResult {
	id: string
	runAt: string
	problemSet: BenchProblemSet
	models: string[]
	config: BenchConfig
	results: BenchModelResult[]
}

export interface BenchModelResult {
	modelId: string
	modelName: string
	problems: BenchProblemResult[]
	aggregateScore: number
	modeScores: Record<string, number>
	totalCost: number
	totalInputTokens: number
	totalOutputTokens: number
	totalTime: number
}

export interface BenchProblemResult {
	problemId: string
	mode: string
	responseContent: string
	ttft: number
	totalTime: number
	inputTokens: number
	outputTokens: number
	cost: number
	evaluation: BenchEvaluation
}

export interface BenchEvaluation {
	qualityScore: number
	relevanceScore: number
	qualityRationale: string
	relevanceRationale: string
	speedScore: number
	costScore: number
	compositeScore: number
}

export interface BenchConfig {
	problemsPerMode: number
	activeModes: BenchMode[]
	generatorModel: string
	evaluatorModel: string
	maxParallelModels: number
	temperature: number
	weights: {
		quality: number
		relevance: number
		speed: number
		cost: number
	}
}

export interface BenchProgress {
	phase: "generating" | "running" | "evaluating" | "complete" | "error"
	currentModel?: string
	currentProblem?: number
	totalProblems?: number
	modelsCompleted?: number
	totalModels?: number
	message?: string
}

export const DEFAULT_BENCH_CONFIG: BenchConfig = {
	problemsPerMode: 2,
	activeModes: [...BENCH_MODES],
	generatorModel: "",
	evaluatorModel: "",
	maxParallelModels: 3,
	temperature: 0,
	weights: {
		quality: 0.5,
		relevance: 0.2,
		speed: 0.15,
		cost: 0.15,
	},
}

export interface BenchRawResponse {
	modelId: string
	problemId: string
	mode: string
	responseContent: string
	diff?: string
	ttft: number
	totalTime: number
	inputTokens: number
	outputTokens: number
	cost: number
}

/**
 * Abstraction for making LLM API calls within the bench feature.
 * This decouples the bench logic from the specific API provider system used by the host extension.
 */
export interface BenchApiHandler {
	/**
	 * Stream a message to the LLM and return chunks.
	 * Returns an async iterable of chunks with type "text" or "usage".
	 */
	createMessage(
		systemPrompt: string,
		userPrompt: string,
		modelId?: string,
	): AsyncIterable<BenchStreamChunk>

	/** Get the current model ID being used. */
	getModelId(): string
}

export type BenchStreamChunk =
	| { type: "text"; text: string }
	| { type: "usage"; inputTokens: number; outputTokens: number; totalCost?: number }

/** Thrown when the API returns a credit/billing error */
export class BenchCreditError extends Error {
	constructor(message?: string) {
		super(message || "Insufficient credits. Please add credits to your Kilo Gateway account to continue.")
		this.name = "BenchCreditError"
	}
}

/** Checkpoint for resuming an interrupted benchmark */
export interface BenchCheckpoint {
	/** Unique run ID for matching */
	runId: string
	/** When the run started */
	startedAt: string
	/** Models being benchmarked */
	models: string[]
	/** Generated problem set */
	problemSet: BenchProblemSet
	/** Config used for this run */
	config: BenchConfig
	/** Phase where interruption occurred */
	phase: "running" | "evaluating"
	/** Raw responses collected so far (running phase) */
	completedResponses: BenchRawResponse[]
	/** Evaluations collected so far (evaluating phase) */
	completedEvaluations: Record<string, { qualityScore: number; relevanceScore: number; qualityRationale: string; relevanceRationale: string }>
	/** Error that caused the interruption */
	interruptReason: string
}
