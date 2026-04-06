import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { resolveTaskModel } from "@/devilcode/team/router" // devilcode_change
import { getConcurrencyManager } from "@/devilcode/team/concurrency" // devilcode_change

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const allowsTask = agent.permission.some((rule) => rule.permission === "task" && rule.action === "allow") // devilcode_change

      // devilcode_change start — unlock nesting for team roles that can delegate
      const teamCanDelegate =
        config.team?.enabled &&
        config.team.roles[params.subagent_type] &&
        config.team.roles[params.subagent_type].canDelegate.length > 0
      const effectiveAllowsTask = allowsTask || !!teamCanDelegate
      // devilcode_change end

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(params.task_id).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "todoread",
              pattern: "*",
              action: "deny",
            },
            ...(effectiveAllowsTask
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      // devilcode_change start — team model routing
      const teamModel = resolveTaskModel({
        subagentType: params.subagent_type,
        teamConfig: config.team,
        parentRole: (ctx as any).teamRole,
      })
      const model = teamModel?.model ?? agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const resolvedRole = teamModel?.role
      // devilcode_change end

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
          teamRole: resolvedRole, // devilcode_change
        },
      })

      const messageID = Identifier.ascending("message")

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      // devilcode_change start — concurrency tracking
      const concurrency = getConcurrencyManager()
      if (resolvedRole) {
        const roleConfig = config.team?.roles[resolvedRole]
        if (roleConfig && !concurrency.hasCapacity(resolvedRole, roleConfig.maxConcurrent)) {
          throw new Error(
            `Role "${resolvedRole}" at max concurrency (${roleConfig.maxConcurrent}). Wait for active tasks to complete.`,
          )
        }
        concurrency.acquire(resolvedRole, session.id)
      }

      let result
      try {
        result = await SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: {
            todowrite: false,
            todoread: false,
            ...(effectiveAllowsTask ? {} : { task: false }),
            ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
          },
          parts: promptParts,
        })
      } finally {
        if (resolvedRole) {
          concurrency.release(resolvedRole, session.id)
        }
      }
      // devilcode_change end

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
        output,
      }
    },
  }
})
