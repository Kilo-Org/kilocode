// kilocode_change - new file

import type { ObservationStep } from "./types"

export class ObservationStepManager {
	private steps: Map<string, ObservationStep> = new Map()

	constructor(private config: { maxConcurrentSteps: number }) {}

	createStep(id: string, description: string, priority: number = 0): ObservationStep {
		const step: ObservationStep = {
			id,
			description,
			priority,
			status: "pending",
		}
		this.steps.set(id, step)
		return step
	}

	getStep(id: string): ObservationStep | undefined {
		return this.steps.get(id)
	}

	updateStep(id: string, updates: Partial<ObservationStep>): boolean {
		const step = this.steps.get(id)
		if (!step) return false

		Object.assign(step, updates)
		this.steps.set(id, step)
		return true
	}

	completeStep(id: string, result?: unknown): boolean {
		return this.updateStep(id, {
			status: "completed",
			result,
		})
	}

	failStep(id: string, error: string): boolean {
		return this.updateStep(id, {
			status: "failed",
			error,
		})
	}

	getPendingSteps(): ObservationStep[] {
		return Array.from(this.steps.values())
			.filter((step) => step.status === "pending")
			.sort((a, b) => b.priority - a.priority)
	}

	getCompletedSteps(): ObservationStep[] {
		return Array.from(this.steps.values()).filter((step) => step.status === "completed")
	}

	getFailedSteps(): ObservationStep[] {
		return Array.from(this.steps.values()).filter((step) => step.status === "failed")
	}

	clearCompletedSteps(): void {
		for (const [id, step] of this.steps.entries()) {
			if (step.status === "completed" || step.status === "failed") {
				this.steps.delete(id)
			}
		}
	}

	getStepCount(): number {
		return this.steps.size
	}

	getStepStats(): { pending: number; inProgress: number; completed: number; failed: number } {
		const steps = Array.from(this.steps.values())
		return {
			pending: steps.filter((s) => s.status === "pending").length,
			inProgress: steps.filter((s) => s.status === "in_progress").length,
			completed: steps.filter((s) => s.status === "completed").length,
			failed: steps.filter((s) => s.status === "failed").length,
		}
	}
}
