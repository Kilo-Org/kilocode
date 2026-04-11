import fs from "fs/promises"
import path from "path"
import matter from "gray-matter"
import { Mutex } from "./mutex"
import { WorkflowState, PlanTask, PlanChallenge, ReviewVerdict, ShipReport, RetroReport } from "./types"

function phaseName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return slug || "phase"
}

function frontmatter<T extends Record<string, unknown>>(data: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter((entry) => entry[1] !== undefined),
  )
}

export class WorkflowStateManager {
  private basePath: string
  private planningDir: string
  private mutex = new Mutex()

  constructor(basePath: string) {
    this.basePath = basePath
    this.planningDir = path.join(basePath, ".planning")
  }

  async hasWorkflow(): Promise<boolean> {
    try {
      await fs.stat(path.join(this.planningDir, "STATE.md"))
      return true
    } catch {
      return false
    }
  }

  async initialize(projectName: string): Promise<void> {
    await fs.mkdir(path.join(this.planningDir, "phases"), { recursive: true })
    await fs.mkdir(path.join(this.planningDir, "milestones"), { recursive: true })

    const now = new Date().toISOString()
    const initialState: WorkflowState = {
      project: projectName,
      currentPhase: "",
      currentStage: "plan",
      activeTasks: [],
      lastUpdated: now,
    }
    await this.writeState(initialState)

    // Create PROJECT.md stub
    const projectMd = path.join(this.planningDir, "PROJECT.md")
    try {
      await fs.stat(projectMd)
    } catch {
      await fs.writeFile(
        projectMd,
        `# ${projectName}\n\n## Vision\n\n<!-- Define the project vision -->\n\n## Constraints\n\n<!-- Define constraints -->\n\n## Success Criteria\n\n<!-- Define success criteria -->\n`,
      )
    }

    // Create ROADMAP.md stub
    const roadmapMd = path.join(this.planningDir, "ROADMAP.md")
    try {
      await fs.stat(roadmapMd)
    } catch {
      await fs.writeFile(roadmapMd, `# Roadmap\n\n<!-- Phases will be added as they are planned -->\n`)
    }
  }

  async readState(): Promise<WorkflowState> {
    const content = await fs.readFile(path.join(this.planningDir, "STATE.md"), "utf-8")
    const { data } = matter(content)
    return WorkflowState.parse(data)
  }

  async writeState(state: WorkflowState): Promise<void> {
    await this.mutex.run(async () => {
      const next = {
        ...state,
        lastUpdated: new Date().toISOString(),
      }
      const content = matter.stringify("", frontmatter(next))
      await fs.writeFile(path.join(this.planningDir, "STATE.md"), content)
    })
  }

  async updateState(fn: (state: WorkflowState) => WorkflowState | Promise<WorkflowState>): Promise<WorkflowState> {
    return await this.mutex.run(async () => {
      const state = await this.readState()
      const next = {
        ...(await fn(state)),
        lastUpdated: new Date().toISOString(),
      }
      const content = matter.stringify("", frontmatter(next))
      await fs.writeFile(path.join(this.planningDir, "STATE.md"), content)
      return WorkflowState.parse(next)
    })
  }

  async createPhase(phaseSlug: string): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    await fs.mkdir(phaseDir, { recursive: true })

    const contextMd = path.join(phaseDir, "CONTEXT.md")
    try {
      await fs.stat(contextMd)
    } catch {
      await fs.writeFile(
        contextMd,
        `# ${phaseSlug} Context\n\n## Requirements\n\n<!-- Phase requirements -->\n\n## Relevant Code\n\n<!-- Key files and modules -->\n\n## Constraints\n\n<!-- Phase-specific constraints -->\n`,
        )
    }
  }

  async ensurePhase(input: string): Promise<string> {
    const state = await this.readState()
    if (state.currentPhase) return state.currentPhase

    const phaseDir = path.join(this.planningDir, "phases")
    const dirs = await fs.readdir(phaseDir).catch(() => [])
    const num = dirs.reduce((max, item) => {
      const next = Number.parseInt(item.slice(0, 2), 10)
      return Number.isFinite(next) && next > max ? next : max
    }, 0) + 1
    const phase = `${String(num).padStart(2, "0")}-${phaseName(input)}`

    await this.createPhase(phase)
    await this.writeState({
      ...state,
      currentPhase: phase,
    })
    return phase
  }

  async writePhaseContext(phaseSlug: string, input: string): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    await fs.mkdir(phaseDir, { recursive: true })
    await fs.writeFile(
      path.join(phaseDir, "CONTEXT.md"),
      `# ${phaseSlug} Context\n\n## Requirements\n\n${input.trim()}\n\n## Relevant Code\n\n<!-- Key files and modules -->\n\n## Constraints\n\n<!-- Phase-specific constraints -->\n`,
    )
  }

  async readPhaseContext(phaseSlug: string): Promise<string> {
    return await fs.readFile(path.join(this.planningDir, "phases", phaseSlug, "CONTEXT.md"), "utf-8")
  }

  async writePlan(phaseSlug: string, task: PlanTask): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${task.id}-PLAN.md`
    const filePath = path.join(phaseDir, filename)

    const { description, ...frontmatterData } = task
    const content = matter.stringify(`\n## Task Description\n\n${description}\n`, frontmatterData)
    await fs.writeFile(filePath, content)
  }

  async readPlan(phaseSlug: string, taskId: string): Promise<PlanTask> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${taskId}-PLAN.md`
    const content = await fs.readFile(path.join(phaseDir, filename), "utf-8")
    const { data, content: body } = matter(content)

    const descriptionMatch = body.match(/## Task Description\s*\n\n([\s\S]*?)$/)
    const description = descriptionMatch?.[1]?.trim() ?? body.trim()

    return PlanTask.parse({ ...data, description })
  }

  async readAllPlans(phaseSlug: string): Promise<PlanTask[]> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const files = await fs.readdir(phaseDir)
    const planFiles = files.filter((f) => f.endsWith("-PLAN.md")).sort()

    const plans: PlanTask[] = []
    for (const file of planFiles) {
      const taskId = file.replace("-PLAN.md", "")
      const plan = await this.readPlan(phaseSlug, taskId)
      plans.push(plan)
    }
    return plans
  }

  async writeSummary(phaseSlug: string, taskId: string, content: string): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${taskId}-SUMMARY.md`
    await fs.writeFile(path.join(phaseDir, filename), content)
  }

  async readSummary(phaseSlug: string, taskId: string): Promise<string> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${taskId}-SUMMARY.md`
    return await fs.readFile(path.join(phaseDir, filename), "utf-8")
  }

  async writeReview(phaseSlug: string, verdict: ReviewVerdict): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${phaseSlug.split("-")[0]}-REVIEW.md`
    const findingsMarkdown = verdict.findings
      .map(
        (f) =>
          `### ${f.id} [${f.severity.toUpperCase()}] ${f.category}: ${f.description}\n- **File:** ${f.file}${f.line ? `:${f.line}` : ""}\n${f.suggestedFix ? `- **Fix:** ${f.suggestedFix}\n` : ""}${f.suggestedRole ? `- **Assigned:** ${f.suggestedRole}\n` : ""}${f.verificationCommand ? `- **Verify:** \`${f.verificationCommand}\`\n` : ""}`,
      )
      .join("\n\n")
    // Store full verdict (including findings) in frontmatter for round-trip fidelity;
    // the markdown body is a human-readable rendering of the same data.
    const content = matter.stringify(`\n## Findings\n\n${findingsMarkdown}\n`, verdict)
    await fs.writeFile(path.join(phaseDir, filename), content)
  }

  async readReview(phaseSlug: string): Promise<ReviewVerdict> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const files = await fs.readdir(phaseDir)
    const reviewFile = files.find((f) => f.endsWith("-REVIEW.md"))
    if (!reviewFile) throw new Error(`No review file found for phase ${phaseSlug}`)
    const content = await fs.readFile(path.join(phaseDir, reviewFile), "utf-8")
    const { data } = matter(content)
    return ReviewVerdict.parse(data)
  }

  async writeChallenge(phaseSlug: string, challenge: PlanChallenge): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${phaseSlug.split("-")[0]}-CHALLENGE.md`
    const content = matter.stringify(`\n## Summary\n\n${challenge.summary}\n`, challenge)
    await fs.writeFile(path.join(phaseDir, filename), content)
  }

  async readChallenge(phaseSlug: string): Promise<PlanChallenge> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const files = await fs.readdir(phaseDir)
    const challengeFile = files.find((f) => f.endsWith("-CHALLENGE.md"))
    if (!challengeFile) throw new Error(`No challenge file found for phase ${phaseSlug}`)
    const content = await fs.readFile(path.join(phaseDir, challengeFile), "utf-8")
    const { data } = matter(content)
    return PlanChallenge.parse(data)
  }

  async writeShip(phaseSlug: string, report: ShipReport): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${phaseSlug.split("-")[0]}-SHIP.md`
    const gates = report.gates.length === 0
      ? "No quality gates detected."
      : report.gates
          .map((gate) => `- ${gate.passed ? "[PASS]" : "[FAIL]"} ${gate.gateName} (${gate.durationMs}ms)`)
          .join("\n")
    const warnings = report.warnings.length === 0
      ? "None."
      : report.warnings.map((line) => `- ${line}`).join("\n")
    const body = [
      "## Summary",
      "",
      report.summary,
      "",
      "## Gates",
      "",
      gates,
      "",
      "## Warnings",
      "",
      warnings,
      "",
    ].join("\n")
    const content = matter.stringify(`\n${body}`, report)
    await fs.writeFile(path.join(phaseDir, filename), content)
  }

  async readShip(phaseSlug: string): Promise<ShipReport> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const files = await fs.readdir(phaseDir)
    const shipFile = files.find((f) => f.endsWith("-SHIP.md"))
    if (!shipFile) throw new Error(`No ship file found for phase ${phaseSlug}`)
    const content = await fs.readFile(path.join(phaseDir, shipFile), "utf-8")
    const { data } = matter(content)
    return ShipReport.parse(data)
  }

  async writeRetro(phaseSlug: string, report: RetroReport): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${phaseSlug.split("-")[0]}-RETRO.md`
    const lessons = report.lessons.length === 0
      ? "No lessons captured."
      : report.lessons.map((line) => `- ${line}`).join("\n")
    const followUps = report.followUps.length === 0
      ? "None."
      : report.followUps.map((line) => `- ${line}`).join("\n")
    const body = [
      "## Summary",
      "",
      report.summary,
      "",
      "## Lessons",
      "",
      lessons,
      "",
      "## Follow-Ups",
      "",
      followUps,
      "",
    ].join("\n")
    const content = matter.stringify(`\n${body}`, report)
    await fs.writeFile(path.join(phaseDir, filename), content)
  }

  async readRetro(phaseSlug: string): Promise<RetroReport> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const files = await fs.readdir(phaseDir)
    const retroFile = files.find((f) => f.endsWith("-RETRO.md"))
    if (!retroFile) throw new Error(`No retro file found for phase ${phaseSlug}`)
    const content = await fs.readFile(path.join(phaseDir, retroFile), "utf-8")
    const { data } = matter(content)
    return RetroReport.parse(data)
  }

  async toPromptSection(): Promise<string | undefined> {
    if (!(await this.hasWorkflow())) return undefined
    const state = await this.readState()
    return [
      `<workflow_context>`,
      `Project: ${state.project}`,
      `Phase: ${state.currentPhase || "(none)"}`,
      `Stage: ${state.currentStage}`,
      state.activeWave !== undefined ? `Wave: ${state.activeWave}/${state.totalWaves ?? "?"}` : null,
      state.activeTasks.length > 0
        ? `Active Tasks:\n${state.activeTasks.map((t) => `  - ${t.id} (${t.role}): ${t.status}`).join("\n")}`
        : null,
      `</workflow_context>`,
    ]
      .filter(Boolean)
      .join("\n")
  }
}
