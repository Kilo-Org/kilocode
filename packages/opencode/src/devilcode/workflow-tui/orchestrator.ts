// packages/opencode/src/devilcode/workflow-tui/orchestrator.ts
import { WorkflowStateManager } from "../workflow/state"
import { Workflow } from "../workflow"
import { groupByWave, validateWaveIntegrity, detectFileConflicts } from "../workflow/executor"
import { triageFindings, routeFix, MAX_REVIEW_CYCLES } from "../workflow/reviewer"
import type { WorkflowStage, PlanTask, ReviewFinding } from "../workflow/types"
import type { TeamConfig } from "../team/config"
import { Instance } from "@/project/instance"

export class WorkflowOrchestrator {
  private manager: WorkflowStateManager

  constructor() {
    this.manager = new WorkflowStateManager(Instance.directory)
  }

  async initialize(projectName: string): Promise<void> {
    await this.manager.initialize(projectName)
  }

  async hasWorkflow(): Promise<boolean> {
    return this.manager.hasWorkflow()
  }

  async getManager(): Promise<WorkflowStateManager> {
    return this.manager
  }

  async validateBuild(): Promise<{ valid: boolean; errors: string[] }> {
    const state = await this.manager.readState()
    if (!state.currentPhase) return { valid: false, errors: ["No current phase set"] }

    const plans = await this.manager.readAllPlans(state.currentPhase)
    if (plans.length === 0) return { valid: false, errors: ["No plan tasks found"] }

    const integrityErrors = validateWaveIntegrity(plans)
    const conflicts = detectFileConflicts(plans)
    const allErrors = [...integrityErrors, ...conflicts]

    return { valid: allErrors.length === 0, errors: allErrors }
  }

  async getWaves(): Promise<Map<number, PlanTask[]>> {
    const state = await this.manager.readState()
    if (!state.currentPhase) return new Map()
    const plans = await this.manager.readAllPlans(state.currentPhase)
    return groupByWave(plans)
  }

  async advanceStage(stage: WorkflowStage): Promise<void> {
    await Workflow.advanceStage(this.manager, stage)
  }

  async triageReview(): Promise<{
    blockers: ReviewFinding[]
    warnings: ReviewFinding[]
    suggestions: ReviewFinding[]
    needsFixes: boolean
  }> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const review = await this.manager.readReview(state.currentPhase)
    const { blockers, warnings, suggestions } = triageFindings(review.findings)

    return {
      blockers,
      warnings,
      suggestions,
      needsFixes: blockers.length > 0 && review.cycle < MAX_REVIEW_CYCLES,
    }
  }

  async getFixRouting(
    findings: ReviewFinding[],
    teamConfig: TeamConfig,
  ): Promise<Map<string, ReviewFinding[]>> {
    const routing = new Map<string, ReviewFinding[]>()
    for (const finding of findings) {
      const role = routeFix(finding, teamConfig)
      const existing = routing.get(role) ?? []
      existing.push(finding)
      routing.set(role, existing)
    }
    return routing
  }
}

let instance: WorkflowOrchestrator | undefined

export function getOrchestrator(): WorkflowOrchestrator {
  if (!instance) {
    instance = new WorkflowOrchestrator()
  }
  return instance
}
