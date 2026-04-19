// packages/opencode/src/devilcode/workflow-tui/orchestrator.ts
import fs from "fs/promises"
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
import type {
  WorkflowStage,
  PlanTask,
  PlanChallenge,
  ReviewFinding,
  ReviewVerdict,
  ActiveTask,
  TaskResult,
  ShipReport,
  RetroReport,
} from "../workflow/types"
import type { CanonicalTeamConfig as TeamConfig } from "../team/config"

export class WorkflowOrchestrator {
  private manager: WorkflowStateManager
  private locks: LockManager
  private lessons: LessonStore
  private events: EventLogger
  private taskLastActivity: Map<string, number> = new Map()
  private runner: BuildRunner | undefined
  readonly directory: string

  constructor(directory: string) {
    this.directory = directory
    this.manager = new WorkflowStateManager(directory)
    const planningDir = path.join(directory, ".planning")
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

    await this.manager.writeChallenge(state.currentPhase, challenge)

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
    const total = groupByWave(plans).size
    const prior = new Map(state.activeTasks.map((task) => [task.id, task.status]))
    const active = plans.map((task) => ({
      id: task.id,
      role: task.role,
      status: prior.get(task.id) === "completed" ? "completed" : "pending",
    }) satisfies ActiveTask)

    await this.manager.updateState((current) => ({
      ...current,
      totalWaves: total,
      activeTasks: active,
    }))

    const pending = plans.filter((task) => prior.get(task.id) !== "completed")
    if (pending.length === 0) {
      await this.events.log({
        eventType: "stage_advanced",
        message: "Build already complete. Review is ready.",
      })
      return []
    }

    const self = this
    const runner = new BuildRunner({
      teamConfig,
      lockManager: this.locks,
      lessonStore: this.lessons,
      eventLogger: this.events,
      onWaveStart(wave) {
        self.manager.updateState((current) => ({
          ...current,
          activeWave: wave,
          totalWaves: total,
        })).catch(() => {})
        callbacks.onWaveStart?.(wave, total)
      },
      onPause(wave) {
        self.events.log({
          eventType: "stage_advanced",
          message: `Build paused after wave ${wave}. Run build again to resume.`,
        }).catch(() => {})
        callbacks.onPause?.(wave)
      },
      onTaskStart(taskId, sessionId) {
        self.recordTaskActivity(taskId)
        self.manager.updateState((current) => ({
          ...current,
          activeTasks: current.activeTasks.map((task) =>
            task.id === taskId
              ? { ...task, status: "in_progress" }
              : task,
          ),
        })).catch(() => {})
        self.events.log({
          eventType: "task_started",
          taskId,
          message: `Task ${taskId} started (session: ${sessionId})`,
        }).catch(() => {})
        callbacks.onTaskStart(taskId, sessionId)
      },
      onTaskComplete(taskId, result) {
        self.recordTaskActivity(taskId)
        self.manager.updateState((current) => ({
          ...current,
          activeTasks: current.activeTasks.map((task) =>
            task.id === taskId
              ? { ...task, status: result.status }
              : task,
          ),
        })).catch(() => {})
        self.events.log({
          eventType: result.status === "completed"
            ? "task_completed"
            : result.status === "escalated"
              ? "task_escalated"
              : "task_failed",
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

    this.runner = runner
    try {
      const results = await runner.executeAll(pending)

      for (const result of results) {
        if (result.status === "completed") {
          await this.manager.writeSummary(
            state.currentPhase,
            result.taskId,
            result.output,
          )
        }
      }

      if (runner.isPaused()) {
        return results
      }

      const completed = results.filter((result) => result.status === "completed").length
      const failed = results.filter((result) => result.status === "failed").length
      const blocked = results.filter((result) => result.status === "blocked").length
      await this.events.log({
        eventType: "stage_advanced",
        message: `Build complete: ${completed} completed, ${failed} failed, ${blocked} blocked out of ${results.length} tasks`,
      })

      return results
    } finally {
      this.runner = undefined
    }
  }

  async executeReview(input: {
    providerID: string
    modelID: string
    diff: string
    cycle: number
  }): Promise<ReviewVerdict> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")
    const unfinished = state.activeTasks.filter((task) => task.status !== "completed")
    if (unfinished.length > 0) {
      throw new Error(
        `Review requires a completed build. Remaining tasks: ${unfinished.map((task) => `${task.id}:${task.status}`).join(", ")}`,
      )
    }

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
    })

    await this.manager.writeReview(state.currentPhase, verdict)

    await this.events.log({
      eventType: "stage_advanced",
      message: `Review cycle ${input.cycle}: ${verdict.verdict} (${verdict.findings.length} findings)`,
    })

    return verdict
  }

  async executeShip(): Promise<ShipReport> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const review = await this.manager.readReview(state.currentPhase)
    if (review.verdict !== "pass" || review.blockerCount > 0) {
      throw new Error("Ship requires a passing review with no blockers.")
    }

    const gates = await this.runQualityGates()
    const failures = summarizeGateFailures(gates)
    const warnings = [
      ...(review.warningCount > 0 ? [`${review.warningCount} review warnings remain.`] : []),
      ...(review.suggestionCount > 0 ? [`${review.suggestionCount} review suggestions remain.`] : []),
      ...(failures ? [failures] : []),
    ]
    const report: ShipReport = {
      phase: state.currentPhase,
      status: failures ? "blocked" : "ready",
      gates,
      warnings,
      summary: failures
        ? `Ship blocked for ${state.currentPhase}. Resolve failing quality gates before advancing.`
        : `Ship ready for ${state.currentPhase}. Final quality gates passed.`,
      createdAt: new Date().toISOString(),
    }

    await this.manager.writeShip(state.currentPhase, report)
    if (report.status === "ready") {
      await this.markRoadmapPhase(state.currentPhase, report.summary)
    }

    await this.events.log({
      eventType: "stage_advanced",
      message: report.summary,
    })

    return report
  }

  async executeRetro(): Promise<RetroReport> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const ship = await this.manager.readShip(state.currentPhase)
    const review = await this.manager.readReview(state.currentPhase)
    const lessons = (await this.lessons.list())
      .slice(0, 5)
      .map((lesson) => `${lesson.title}: ${lesson.resolution}`)
    const completed = state.activeTasks.filter((task) => task.status === "completed").length
    const failed = state.activeTasks.filter((task) => task.status === "failed" || task.status === "escalated").length
    const blocked = state.activeTasks.filter((task) => task.status === "blocked").length
    const followUps = [
      ...review.findings
        .filter((finding) => finding.severity !== "blocker")
        .map((finding) => `${finding.id} ${finding.category}: ${finding.description}`),
      ...ship.warnings,
    ].slice(0, 5)
    const report: RetroReport = {
      phase: state.currentPhase,
      completed,
      failed,
      blocked,
      lessons,
      followUps,
      summary: `Retro captured for ${state.currentPhase}: ${completed} completed, ${failed} failed, ${blocked} blocked.`,
      createdAt: new Date().toISOString(),
    }

    await this.manager.writeRetro(state.currentPhase, report)
    await this.events.log({
      eventType: "stage_advanced",
      message: report.summary,
    })

    return report
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
    const report = await runPreflight(this.directory)
    await this.events.log({
      eventType: "preflight_check",
      message: `Preflight: ${preflightPassed(report) ? "PASSED" : "FAILED"}`,
    })
    return report
  }

  // --- Quality Gates ---

  async runQualityGates(): Promise<GateResult[]> {
    const gates = await detectGates(this.directory)
    const results = await runAllGates(gates, this.directory)
    for (const r of results) {
      await this.events.log({
        eventType: r.passed ? "quality_gate_passed" : "quality_gate_failed",
        message: `${r.gateName}: ${r.passed ? "PASS" : "FAIL"}`,
        durationMs: r.durationMs,
      })
    }
    return results
  }

  pauseBuild(): boolean {
    if (!this.runner) return false
    this.runner.requestPause()
    return true
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

  private async markRoadmapPhase(phase: string, summary: string): Promise<void> {
    const file = path.join(this.directory, ".planning", "ROADMAP.md")
    const line = `- [x] ${phase} - ${summary}`
    const current = await fs.readFile(file, "utf-8").catch(() => "# Roadmap\n")
    const pattern = new RegExp(`^- \\[(?: |x)\\] ${phase}.*$`, "m")
    const next = pattern.test(current)
      ? current.replace(pattern, line)
      : `${current.trimEnd()}\n${current.endsWith("\n") ? "" : "\n"}${line}\n`
    await fs.writeFile(file, next)
  }

  // --- Health ---

  recordTaskActivity(taskId: string): void {
    this.taskLastActivity.set(taskId, Date.now())
  }

  checkHealth(tasks: ActiveTask[], planTasks?: PlanTask[]): {
    stuckAlerts: HealthAlert[]
    deadlock: DeadlockResult | null
  } {
    const stuckAlerts = detectStuckTasks(tasks, this.taskLastActivity, DEFAULT_HEALTH_CONFIG)
    const deps = new Map<string, string[]>()
    if (planTasks) {
      for (const pt of planTasks) {
        if (pt.dependsOn.length > 0) {
          deps.set(pt.id, pt.dependsOn)
        }
      }
    }
    const deadlock = detectDeadlock(tasks, deps)
    return { stuckAlerts, deadlock }
  }
}

const orchestratorCache = new Map<string, WorkflowOrchestrator>()

export function getOrchestrator(directory: string): WorkflowOrchestrator {
  let orch = orchestratorCache.get(directory)
  if (!orch) {
    orch = new WorkflowOrchestrator(directory)
    orchestratorCache.set(directory, orch)
  }
  return orch
}
