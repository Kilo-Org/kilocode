import { define, type Context } from "@opencode-ai/plugin/effect/plugin"
import { Agent } from "@opencode-ai/schema/agent"
import { Tool } from "@opencode-ai/schema/tool"
import { Effect, Schema } from "effect"
import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import planPrompt from "./plan-prompt.txt" with { type: "text" }
import type { ToolAuthorizer } from "./tool-authorization"

export const PLAN_POLICY_ID = "opencode.plan"
type PlanPolicyOptions = { readonly authorize?: ToolAuthorizer }
const plan = Agent.ID.make("plan")
const choices = {
  newSession: "Start new session",
  continue: "Continue here",
  refine: "Keep refining",
} as const

const PlanExitInput = Schema.Struct({
  path: Schema.String.annotate({
    description: "Exact saved Markdown plan path under this project's .kilo/plans directory",
  }),
})

const PlanExitOutput = Schema.Struct({
  plan: Schema.String,
  choice: Schema.Literals([choices.newSession, choices.continue, choices.refine]),
})

/**
 * Host-enforced replacement for v2's builtin Plan plugin. It deliberately uses
 * the native question tool's bound executor so form display, cancellation, and
 * permission evaluation stay owned by Core.
 */
export function createPlanPolicy(options: PlanPolicyOptions = {}) {
  return define({
    id: PLAN_POLICY_ID,
    effect: Effect.fn("KiloPlanPolicy.effect")(function* (ctx: Context) {
      let codeAgent = Agent.ID.make("build")
      let owned = false
      yield* ctx.agent.transform((editor) => {
        // Agent transforms rerun after config changes. A newly configured Plan
        // agent must never inherit ownership from the preceding native Plan.
        owned = false
        codeAgent = Agent.ID.make(editor.get("code") ? "code" : "build")
        const build = editor.get("build")
        if (editor.get(plan)) return
        owned = true
        editor.update(plan, (item) => {
          item.name = Agent.Name.make("Plan")
          item.description = "Plan work before implementation."
          item.mode = "primary"
          item.system = planPrompt.replace("{{timestamp}}", String(Date.now()))
          item.permissions.push(
            { action: "*", resource: "*", effect: "deny" },
            { action: "question", resource: "*", effect: "allow" },
            { action: "plan_exit", resource: "*", effect: "allow" },
            { action: "read", resource: "*", effect: "allow" },
            { action: "read", resource: "*.env", effect: "ask" },
            { action: "read", resource: "*.env.*", effect: "ask" },
            { action: "read", resource: "*.env.example", effect: "allow" },
            { action: "grep", resource: "*", effect: "allow" },
            { action: "glob", resource: "*", effect: "allow" },
            { action: "webfetch", resource: "*", effect: "allow" },
            { action: "websearch", resource: "*", effect: "allow" },
            { action: "semantic_search", resource: "*", effect: "allow" },
            {
              // Permission resources for in-Location mutations are Location-relative
              // (LocationMutation.Target.resource), never absolute.
              action: "edit",
              resource: ".kilo/plans/*.md",
              effect: "allow",
            },
            { action: "shell", resource: "*", effect: "deny" },
            { action: "subagent", resource: "*", effect: "deny" },
            // Config discovery ran before this agent existed, so retain its
            // explicit global denials without importing any configured allows.
            ...(build?.permissions.filter((rule) => rule.effect === "deny") ?? []),
          )
        })
      })

      yield* ctx.tool.transform((editor) => {
        const question = editor.get("question")
        editor.add({
          name: "plan_exit",
          options: { codemode: false, permission: "plan_exit" },
          description:
            "Signal that planning is complete after saving an exact Markdown plan under .kilo/plans. The user then chooses whether to start implementation, continue here, or keep refining.",
          input: PlanExitInput,
          output: PlanExitOutput,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (!owned || context.agent !== plan)
                return yield* new Tool.Error({ message: "plan_exit is available only to Kilo's built-in Plan agent" })
              yield* authorizePlanExit(options, context)
              const planFile = yield* validatePlanPath(input.path, ctx.location.directory)
              if (
                !question ||
                !Schema.isSchema(question.input) ||
                !question.output ||
                !Schema.isSchema(question.output)
              )
                return yield* new Tool.Error({ message: "Native question tool is unavailable for Plan completion" })
              const prompt = yield* Schema.decodeUnknownEffect(question.input)({
                questions: [
                  {
                    header: "Implement",
                    question: "Ready to implement?",
                    options: [
                      {
                        label: choices.newSession,
                        description: "Implement in a fresh session with a clean context",
                      },
                      {
                        label: choices.continue,
                        description: "Implement the plan in this session",
                      },
                      {
                        label: choices.refine,
                        description: "Keep planning without implementing yet",
                      },
                    ],
                  },
                ],
              }).pipe(
                Effect.mapError(
                  () => new Tool.Error({ message: "Native question tool has an incompatible input schema" }),
                ),
              )
              // Call the captured executor with the original tool context. In particular,
              // its cancelled Form state remains a defect and must not become an approval.
              const asked = yield* question.execute(prompt, context)
              const answered = yield* Schema.decodeUnknownEffect(question.output)(asked.output).pipe(
                Effect.mapError(
                  () => new Tool.Error({ message: "Native question tool returned an incompatible answer" }),
                ),
              )
              const choice = answerChoice(answered)
              if (!choice)
                return yield* new Tool.Error({
                  message:
                    "Plan implementation requires one of the listed completion choices; this plan remains in Plan mode",
                })
              if (choice === choices.refine)
                return { output: { plan: planFile, choice }, content: "Continuing Plan mode." }
              if (choice === choices.continue) {
                yield* ctx.session.switchAgent({ sessionID: context.sessionID, agent: codeAgent })
                yield* ctx.session.prompt({
                  sessionID: context.sessionID,
                  text: implementationPrompt(planFile),
                  delivery: "steer",
                })
                return { output: { plan: planFile, choice }, content: `Implementing ${planFile} in this session.` }
              }
              const current = yield* ctx.session.get({ sessionID: context.sessionID })
              const next = yield* ctx.session.create({
                agent: codeAgent,
                ...(current.model ? { model: current.model } : {}),
              })
              yield* ctx.session.prompt({ sessionID: next.id, text: implementationPrompt(planFile), delivery: "steer" })
              return {
                output: { plan: planFile, choice },
                metadata: { kiloPlanHandoff: { sessionID: next.id } },
                content: `Implementing ${planFile} in a new Code session (${next.id}).`,
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof Tool.Error
                  ? error
                  : new Tool.Error({
                      message: error instanceof Error ? error.message : "Unable to complete Plan mode",
                    }),
              ),
            ),
        })
      })
    }),
  })
}

function authorizePlanExit(options: PlanPolicyOptions, context: Tool.Context) {
  if (!options.authorize) return Effect.fail(new Tool.Error({ message: "Tool authorization is unavailable" }))
  return options.authorize({
    action: "plan_exit",
    sessionID: context.sessionID,
    agent: context.agent,
    messageID: context.messageID,
    callID: context.id,
  })
}

function validatePlanPath(file: string, directory: string) {
  return Effect.tryPromise({
    try: async () => {
      if (path.extname(file).toLowerCase() !== ".md") throw new Error("Plan file must be a Markdown file")
      const kilo = path.join(directory, ".kilo")
      const plans = path.join(kilo, "plans")
      const candidate = path.resolve(directory, file)
      if (!contains(plans, candidate)) throw new Error("Plan file must be under this project's .kilo/plans directory")
      const [project, kiloStat, plansStat] = await Promise.all([
        realpath(directory),
        optionalStat(kilo),
        optionalStat(plans),
      ])
      if (!kiloStat || !plansStat)
        throw new Error("Plan directory does not exist yet; save the plan under .kilo/plans before calling plan_exit")
      if (
        !kiloStat.isDirectory() ||
        kiloStat.isSymbolicLink() ||
        !plansStat.isDirectory() ||
        plansStat.isSymbolicLink()
      )
        throw new Error("Plan directory must be a real directory within this project")
      const stat = await optionalStat(candidate)
      if (!stat) throw new Error(`Plan file does not exist yet; save the plan to ${file} before calling plan_exit`)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0)
        throw new Error("Plan file must be a non-empty regular file")
      const root = await realpath(plans)
      if (!contains(project, root)) throw new Error("Plan directory must be within this project")
      const resolved = await realpath(candidate)
      if (!contains(root, resolved)) throw new Error("Plan file must be under this project's .kilo/plans directory")
      return resolved
    },
    catch: (error) => new Tool.Error({ message: error instanceof Error ? error.message : "Invalid Plan file" }),
  })
}

function optionalStat(target: string) {
  return lstat(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return undefined
  })
}

function contains(root: string, file: string) {
  const relative = path.relative(root, file)
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)
}

function answerChoice(value: unknown): (typeof choices)[keyof typeof choices] | undefined {
  if (!value || typeof value !== "object") return undefined
  const answers = Reflect.get(value, "answers")
  if (!Array.isArray(answers) || answers.length !== 1 || !Array.isArray(answers[0]) || answers[0].length !== 1)
    return undefined
  const choice = answers[0][0]
  return Object.values(choices).find((candidate) => candidate === choice)
}

function implementationPrompt(planFile: string) {
  return `Implement the approved plan at ${planFile}. Read the plan file first and treat it as the source of truth for implementation.`
}
