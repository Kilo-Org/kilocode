// kilocode_change - new file

export interface DecisionEngineConfig {
	maxReflections: number
	observationThreshold: number
	confidenceThreshold: number
	timeoutMs: number
}

export interface ObservationStep {
	id: string
	description: string
	priority: number
	status: "pending" | "in_progress" | "completed" | "failed"
	result?: unknown
	error?: string
}

export interface ReflectionPrompt {
	id: string
	template: string
	context: Record<string, unknown>
	variables: string[]
}

export interface DecisionResult {
	action: string
	confidence: number
	reasoning: string
	observations: ObservationStep[]
	reflections: string[]
}

export interface DecisionEngineState {
	currentStep?: ObservationStep
	completedSteps: ObservationStep[]
	reflections: string[]
	config: DecisionEngineConfig
}
