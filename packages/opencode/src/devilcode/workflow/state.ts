import fs from "fs/promises"
import path from "path"
import matter from "gray-matter"
import { WorkflowState, PlanTask, ReviewVerdict } from "./types"

export class WorkflowStateManager {
  private basePath: string
  private planningDir: string

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
    state.lastUpdated = new Date().toISOString()
    const content = matter.stringify("", state)
    await fs.writeFile(path.join(this.planningDir, "STATE.md"), content)
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
