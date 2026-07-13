// kilocode_change - new file
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Tool } from "@/tool/tool"
import z from "zod"
import { BackgroundSubagentControl } from "./background-subagent-control"

type PublicStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "not_found"

type Metadata = {
  background_task_id?: string
  status: PublicStatus
  ready?: boolean
  applied?: boolean
  error?: string
}

const parameters = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      description: z.string(),
      prompt: z.string(),
      subagent_type: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("status"),
      background_task_id: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("result"),
      background_task_id: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("cancel"),
      background_task_id: z.string(),
    })
    .strict(),
])

function lines(meta: Metadata, text?: string) {
  const out = [] as string[]
  if (meta.background_task_id) out.push(`background_task_id: ${meta.background_task_id}`)
  out.push(`status: ${meta.status}`)
  if (meta.ready !== undefined) out.push(`ready: ${meta.ready}`)
  if (meta.applied !== undefined) out.push(`applied: ${meta.applied}`)
  if (meta.error) out.push(`error: ${meta.error}`)
  if (text !== undefined) {
    out.push("", "<background_task_result>", text, "</background_task_result>")
  }
  return out.join("\n")
}

function state(input: {
  background_task_id?: string
  status: PublicStatus
  ready?: boolean
  applied?: boolean
  error?: string
}) {
  const meta = {
    ...(input.background_task_id ? { background_task_id: input.background_task_id } : {}),
    status: input.status,
    ...(input.ready !== undefined ? { ready: input.ready } : {}),
    ...(input.applied !== undefined ? { applied: input.applied } : {}),
    ...(input.error ? { error: input.error } : {}),
  } satisfies Metadata

  return Object.defineProperty(meta, "truncated", {
    value: false,
    enumerable: false,
  }) as Metadata
}

export const BackgroundTaskTool = Tool.define("background_task", {
  description:
    "Manage background subagent work using parent-scoped task handles. Supports starting, checking status, reading results, and cancellation.",
  parameters,
  async execute(params, ctx) {
    if (params.action === "status") {
      const info = BackgroundSubagentControl.status({
        parentSessionID: ctx.sessionID,
        taskID: params.background_task_id,
      })

      const meta = info
        ? state({
            background_task_id: info.taskID,
            status: info.status,
            error: info.error?.message,
          })
        : state({
            status: "not_found",
          })

      return {
        title: "Background task status",
        metadata: meta,
        output: lines(meta),
      }
    }

    if (params.action === "result") {
      const view = await BackgroundSubagentControl.result({
        parentSessionID: ctx.sessionID,
        taskID: params.background_task_id,
      })

      if (!view) {
        const meta = state({
          status: "not_found",
          ready: false,
        })

        return {
          title: "Background task result",
          metadata: meta,
          output: lines(meta),
        }
      }

      if (!view.message) {
        const meta = state({
          background_task_id: view.info.taskID,
          status: view.info.status,
          ready: false,
          error: view.info.error?.message,
        })

        return {
          title: "Background task result",
          metadata: meta,
          output: lines(meta),
        }
      }

      const text = view.message.parts.findLast((part) => part.type === "text")?.text ?? ""
      const meta = state({
        background_task_id: view.info.taskID,
        status: view.info.status,
        ready: true,
      })

      return {
        title: "Background task result",
        metadata: meta,
        output: lines(meta, text),
      }
    }

    if (params.action === "cancel") {
      const result = await BackgroundSubagentControl.cancel({
        parentSessionID: ctx.sessionID,
        taskID: params.background_task_id,
      })

      const meta = result?.info
        ? state({
            background_task_id: result.info.taskID,
            status: result.info.status,
            applied: result.applied,
            error: result.info.error?.message,
          })
        : state({
            status: "not_found",
            applied: false,
          })

      return {
        title: "Background task cancellation",
        metadata: meta,
        output: lines(meta),
      }
    }

    const config = await Config.get()

    await ctx.ask({
      permission: "task",
      patterns: [params.subagent_type],
      always: ["*"],
      metadata: {
        description: params.description,
        subagent_type: params.subagent_type,
      },
    })

    const agent = await Agent.get(params.subagent_type)
    if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)
    if (agent.mode === "primary") {
      throw new Error(`Agent "${params.subagent_type}" is a primary agent and cannot be used as a subagent`)
    }

    const caller = await Agent.get(ctx.agent)
    const callerSession = await Session.get(ctx.sessionID)
    const callerRules = Permission.merge(caller?.permission ?? [], callerSession.permission ?? [])
    const mcpPrefixes = Object.keys(config.mcp ?? {}).map((k) => k.replace(/[^a-zA-Z0-9_-]/g, "_") + "_")
    const isMcpRule = (p: string) => mcpPrefixes.some((prefix) => p.startsWith(prefix))
    const inherited = callerRules.filter(
      (r) => r.permission === "edit" || r.permission === "bash" || isMcpRule(r.permission),
    )
    const hasTodoWritePermission = agent.permission.some((rule) => rule.permission === "todowrite")

    const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
    if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

    const model = agent.model ?? {
      modelID: msg.info.modelID,
      providerID: msg.info.providerID,
    }

    const info = await BackgroundSubagentControl.start({
      parentSessionID: ctx.sessionID,
      title: params.description + ` (@${agent.name} background subagent)`,
      permission: [
        ...(hasTodoWritePermission
          ? []
          : [
              {
                permission: "todowrite" as const,
                pattern: "*" as const,
                action: "deny" as const,
              },
            ]),
        {
          permission: "task" as const,
          pattern: "*" as const,
          action: "deny" as const,
        },
        {
          permission: "background_task" as const,
          pattern: "*" as const,
          action: "deny" as const,
        },
        ...(config.experimental?.primary_tools?.map((tool) => ({
          permission: tool,
          pattern: "*",
          action: "allow" as const,
        })) ?? []),
        ...inherited,
      ],
      prompt: params.prompt,
      model: {
        modelID: model.modelID,
        providerID: model.providerID,
      },
      agent: agent.name,
      tools: {
        ...(hasTodoWritePermission ? {} : { todowrite: false }),
        task: false,
        background_task: false,
        ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((tool) => [tool, false])),
      },
    })

    const meta = state({
      background_task_id: info.taskID,
      status: info.status,
      error: info.error?.message,
    })

    return {
      title: params.description,
      metadata: meta,
      output: lines(meta),
    }
  },
})
