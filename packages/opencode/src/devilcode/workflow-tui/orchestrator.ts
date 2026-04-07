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
import { dispatchPlan, dispatchChallenge, dispatchReview } from "../workflow/dispatch"
import { BuildRunner, type BuildCallbacks } from "../workflow/build-runner"
import { generateContracts } from "../workflow/contract-generator"
import type { ContractSet } from "../workflow/contracts"
import type { WorkflowStage, PlanTask, PlanChallenge, ReviewFinding, ReviewVerdict, ActiveTask, TaskResult } from "../workflow/types"
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

  async executePlan(input: {
    providerID: string
    modelID: string
    phaseContext: string
    availableRoles: string[]
  }): Promise<PlanTask[]> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const lessons = await this.getLessonsForPrompt()
    const tasks = await dispatchPlan({
      ...input,
      lessons: lessons || undefined,
    })

    for (const task of tasks) {
      await this.manager.writePlan(state.currentPhase, task)
    }

    await this.events.log({
      eventType: "plan_created",
      message: `Generated ${tasks.length} tasks in ${new Set(tasks.map((t) => t.wave)).size} waves`,
    })

    return tasks
  }

  async executeChallenge(input: {
    providerID: string
    modelID: string
    phaseContext: string
  }): Promise<PlanChallenge> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const plans = await this.manager.readAllPlans(state.currentPhase)
    const challenge = await dispatchChallenge({
      ...input,
      planTasks: plans,
    })

    await this.events.log({
      eventType: "stage_advanced",
      message: `Challenge verdict: ${challenge.verdict} (${challenge.concerns.length} concerns)`,
    })

    return challenge
  }

  async executeContracts(): Promise<ContractSet> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const plans = await this.manager.readAllPlans(state.currentPhase)
    const contracts = generateContracts(plans)

    await this.events.log({
      eventType: "contract_generated",
      message: `Generated ${contracts.typeContracts.length} type contracts, ${contracts.integrationHints.length} integration hints`,
    })

    return contracts
  }

  async executeBuild(
    callbacks: BuildCallbacks,
    teamConfig: TeamConfig | undefined,
  ): Promise<TaskResult[]> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const validation = await this.validateBuild()
    if (!validation.valid) {
      throw new Error(`Build validation failed: ${validation.errors.join("; ")}`)
    }

    const plans = await this.manager.readAllPlans(state.currentPhase)
    const self = this
    const runner = new BuildRunner({
      teamConfig,
      lockManager: this.locks,
      lessonStore: this.lessons,
      eventLogger: this.events,
      onTaskStart(taskId, sessionId) {
        self.recordTaskActivity(taskId)
        self.events.log({
          eventType: "task_started",
          taskId,
          message: `Task ${taskId} started (session: ${sessionId})`,
        }).catch(() => {})
        callbacks.onTaskStart(taskId, sessionId)
      },
      onTaskComplete(taskId, result) {
        self.recordTaskActivity(taskId)
        self.events.log({
          eventType: result.status === "completed" ? "task_completed" : "task_failed",
          taskId,
          message: `Task ${taskId}: ${result.status}${result.error ? ` - ${result.error}` : ""}`,
        }).catch(() => {})
        callbacks.onTaskComplete(taskId, result)
      },
      onOutput(taskId, sessionId, line) {
        self.recordTaskActivity(taskId)
        callbacks.onOutput(taskId, sessionId, line)
      },
    })

    const results = await runner.executeAll(plans)

    // Log build completion
    const completed = results.filter((r) => r.status === "completed").length
    const failed = results.filter((r) => r.status === "failed").length
    const blocked = results.filter((r) => r.status === "blocked").length
    await this.events.log({
      eventType: "stage_advanced",
      message: `Build complete: ${completed} completed, ${failed} failed, ${blocked} blocked out of ${results.length} tasks`,
    })

    for (const result of results) {
      if (result.status === "completed") {
        await this.manager.writeSummary(
          state.currentPhase,
          result.taskId,
          result.output,
        )
      }
    }

    return results
  }

  async executeReview(input: {
    providerID: string
    modelID: string
    diff: string
    cycle: number
  }): Promise<ReviewVerdict> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    // Run quality gates before review
    const gateResults = await this.runQualityGates()
    const gateFailures = summarizeGateFailures(gateResults)

    const plans = await this.manager.readAllPlans(state.currentPhase)
    const summaries: string[] = []
    for (const plan of plans) {
      try {
        const summary = await this.manager.readSummary(state.currentPhase, plan.id)
        summaries.push(`${plan.id}: ${summary}`)
      } catch {
        summaries.push(`${plan.id}: (no summary)`)
      }
    }

    const verdict = await dispatchReview({
      ...input,
      summaries,
      gateResults: gateFailures || undefined,
    })

    await this.manager.writeReview(state.currentPhase, verdict)

    await this.events.log({
      eventType: "stage_advanced",
      message: `Review cycle ${input.cycle}: ${verdict.verdict} (${verdict.findings.length} findings, ${gateResults.filter((g) => !g.passed).length} gate failures)`,
    })

    return verdict
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
