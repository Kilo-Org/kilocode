import { generateObject } from "ai"
import z from "zod"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { mergeDeep } from "remeda"
import { Log } from "@/util/log"
import { PlanTask, PlanChallenge, ReviewVerdict } from "./types"
import PLAN_PROMPT from "./prompts/plan.txt"
import CHALLENGE_PROMPT from "./prompts/challenge.txt"
import REVIEW_PROMPT from "./prompts/review.txt"

const log = Log.create({ service: "workflow.dispatch" })

// --- Shared helper ---

async function resolveModel(providerID: string, modelID: string) {
  const model = await Provider.getModel(providerID, modelID)
  const language = await Provider.getLanguage(model)
  return { model, language }
}

// --- Plan Stage ---

export type PlanDispatchInput = {
  providerID: string
  modelID: string
  phaseContext: string
  availableRoles: string[]
  lessons?: string
}

export async function dispatchPlan(input: PlanDispatchInput): Promise<PlanTask[]> {
  log.info("dispatchPlan", { providerID: input.providerID, modelID: input.modelID })

  const { model, language } = await resolveModel(input.providerID, input.modelID)

  const userContent = [
    `## Phase Requirements\n\n${input.phaseContext}`,
    `## Available Roles\n\n${input.availableRoles.join(", ")}`,
    ...(input.lessons ? [`## Lessons from Previous Runs\n\n${input.lessons}`] : []),
  ].join("\n\n")

  const result = await generateObject({
    model: language,
    temperature: model.capabilities.temperature ? 0.3 : undefined,
    providerOptions: ProviderTransform.providerOptions(
      model,
      mergeDeep(ProviderTransform.smallOptions(model), model.options),
    ),
    maxRetries: 2,
    system: PLAN_PROMPT,
    messages: [{ role: "user" as const, content: userContent }],
    schema: z.object({
      tasks: z.array(PlanTask),
    }),
  })

  log.info("dispatchPlan complete", { taskCount: result.object.tasks.length })
  return result.object.tasks
}

// --- Challenge Stage ---

export type ChallengeDispatchInput = {
  providerID: string
  modelID: string
  planTasks: PlanTask[]
  phaseContext: string
}

export async function dispatchChallenge(input: ChallengeDispatchInput): Promise<PlanChallenge> {
  log.info("dispatchChallenge", { providerID: input.providerID, taskCount: input.planTasks.length })

  const { model, language } = await resolveModel(input.providerID, input.modelID)

  const taskSummary = input.planTasks
    .map(
      (t) =>
        `- **${t.id}** (wave ${t.wave}, role: ${t.role}, complexity: ${t.estimatedComplexity}): ${t.title}\n  Files: ${t.files.join(", ") || "none"}\n  Depends on: ${t.dependsOn.join(", ") || "none"}`,
    )
    .join("\n")

  const userContent = [
    `## Phase Context\n\n${input.phaseContext}`,
    `## Plan Tasks\n\n${taskSummary}`,
  ].join("\n\n")

  const result = await generateObject({
    model: language,
    temperature: model.capabilities.temperature ? 0.2 : undefined,
    providerOptions: ProviderTransform.providerOptions(
      model,
      mergeDeep(ProviderTransform.smallOptions(model), model.options),
    ),
    maxRetries: 2,
    system: CHALLENGE_PROMPT,
    messages: [{ role: "user" as const, content: userContent }],
    schema: PlanChallenge,
  })

  log.info("dispatchChallenge complete", { verdict: result.object.verdict })
  return result.object
}

// --- Review Stage ---

export type ReviewDispatchInput = {
  providerID: string
  modelID: string
  summaries: string[]
  diff: string
  cycle: number
  gateResults?: string
}

export async function dispatchReview(input: ReviewDispatchInput): Promise<ReviewVerdict> {
  log.info("dispatchReview", { providerID: input.providerID, cycle: input.cycle })

  const { model, language } = await resolveModel(input.providerID, input.modelID)

  const userContent = [
    `## Review Cycle ${input.cycle}`,
    `## Task Summaries\n\n${input.summaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    `## Code Changes\n\n\`\`\`diff\n${input.diff}\n\`\`\``,
    ...(input.gateResults ? [`## Quality Gate Results\n\n${input.gateResults}`] : []),
  ].join("\n\n")

  const result = await generateObject({
    model: language,
    temperature: model.capabilities.temperature ? 0.2 : undefined,
    providerOptions: ProviderTransform.providerOptions(
      model,
      mergeDeep(ProviderTransform.smallOptions(model), model.options),
    ),
    maxRetries: 2,
    system: REVIEW_PROMPT,
    messages: [{ role: "user" as const, content: userContent }],
    schema: ReviewVerdict,
  })

  log.info("dispatchReview complete", {
    verdict: result.object.verdict,
    findings: result.object.findings.length,
  })
  return result.object
}
