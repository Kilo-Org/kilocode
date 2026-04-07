// packages/opencode/src/devilcode/workflow-tui/orchestrator.ts
import path from "path"
import { WorkflowStateManager } from "../workflow/state"
import { Workflow } from "../workflow"
import { groupByWave, validateWaveIntegrity, detectFileConflicts } from "../workflow/executor"
import { triageFindings, routeFix, MAX_REVIEW_CYCLES } from "../workflow/reviewer"
import { LockManager } from "../workflow/locks"
import { LessonStore, formatLessonsForPrompt } from "../workflow/learning"
import { EventLogger } from "../workflow/events"
import { runPreflight, preflightPassed, type PreflightReport } from "../workflow/preflight"
import { detectGates, runAllGates, summarizeGateFailures, type GateResult } from "../workflow/quality-gates"
import { detectStuckTasks, detectDeadlock, DEFAULT_HEALTH_CONFIG, type HealthAlert, type DeadlockResult } from "../workflow/health"
import type { ContractSet } from "../workflow/contracts"
import type { WorkflowStage, PlanTask, ReviewFinding, ActiveTask } from "../workflow/types"
import type { TeamConfig } from "../team/config"
import { Instance } from "@/project/instance"

export class WorkflowOrchestrator {
  private manager: WorkflowStateManager
  private locks: LockManager
  private lessons: LessonStore
  private events: EventLogger
  private taskLastActivity: Map<string, number> = new Map()

  constructor() {
    this.manager = new WorkflowStateManager(Instance.directory)
    const planningDir = path.join(Instance.directory, ".planning")
    this.locks = new LockManager(planningDir)
    this.lessons = new LessonStore(planningDir)
    this.events = new EventLogger(planningDir)
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

  // --- Pre-flight ---

  async runPreflight(): Promise<PreflightReport> {
    const report = await runPreflight(Instance.directory)
    await this.events.log({
      eventType: "preflight_check",
      message: `Preflight: ${preflightPassed(report) ? "PASSED" : "FAILED"}`,
    })
    return report
  }

  // --- Quality Gates ---

  async runQualityGates(): Promise<GateResult[]> {
    const gates = await detectGates(Instance.directory)
    const results = await runAllGates(gates, Instance.directory)
    for (const r of results) {
      await this.events.log({
        eventType: r.passed ? "quality_gate_passed" : "quality_gate_failed",
        message: `${r.gateName}: ${r.passed ? "PASS" : "FAIL"}`,
        durationMs: r.durationMs,
      })
    }
    return results
  }

  // --- Learning ---

  async getLessonsForPrompt(): Promise<string> {
    const lessons = await this.lessons.list()
    return formatLessonsForPrompt(lessons)
  }

  getLockManager(): LockManager {
    return this.locks
  }

  getLessonStore(): LessonStore {
    return this.lessons
  }

  getEventLogger(): EventLogger {
    return this.events
  }

  // --- Health ---

  recordTaskActivity(taskId: string): void {
    this.taskLastActivity.set(taskId, Date.now())
  }

  checkHealth(tasks: ActiveTask[]): {
    stuckAlerts: HealthAlert[]
    deadlock: DeadlockResult | null
  } {
    const stuckAlerts = detectStuckTasks(tasks, this.taskLastActivity, DEFAULT_HEALTH_CONFIG)
    const deps = new Map<string, string[]>()
    const deadlock = detectDeadlock(tasks, deps)
    return { stuckAlerts, deadlock }
  }
}

let instance: WorkflowOrchestrator | undefined

export function getOrchestrator(): WorkflowOrchestrator {
  if (!instance) {
    instance = new WorkflowOrchestrator()
  }
  return instance
}
