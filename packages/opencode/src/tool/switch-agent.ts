// kilocode_change - new file
import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { Agent } from "../agent/agent"
import { PermissionNext } from "@/permission/next"
import DESCRIPTION from "./switch-agent.txt"

const parameters = z.object({
  agent: z.string().describe("The name of the agent to switch to"),
  reason: z.string().describe("Why the switch is needed"),
})

async function lastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

function validate(target: Agent.Info | undefined, name: string, current: string, available: Agent.Info[]) {
  if (!target) throw new Error(`Unknown agent: "${name}". Available agents: ${available.map((a) => a.name).join(", ")}`)
  if (target.hidden) throw new Error(`Cannot switch to hidden agent "${name}"`)
  if (target.mode === "subagent")
    throw new Error(`Cannot switch to subagent "${name}". Use the task tool to delegate to subagents.`)
  if (target.name === current) throw new Error(`Already using the "${name}" agent`)
}

async function switchMessage(agent: string, reason: string, sessionID: string) {
  const model = await lastModel(sessionID)
  const msg: MessageV2.User = {
    id: Identifier.ascending("message"),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent,
    model,
  }
  await Session.updateMessage(msg)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: msg.id,
    sessionID,
    type: "text",
    text: `User approved switching to the ${agent} agent. Reason: ${reason}`,
    synthetic: true,
  } satisfies MessageV2.TextPart)
}

export const SwitchAgentTool = Tool.define("switch_agent", async (ctx) => {
  const agents = await Agent.list()
  const caller = ctx?.agent
  const available = agents.filter((a) => {
    if (a.mode === "subagent") return false
    if (a.hidden) return false
    if (a.name === caller?.name) return false
    if (caller) return PermissionNext.evaluate("switch_agent", a.name, caller.permission).action !== "deny"
    return true
  })

  return {
    description: DESCRIPTION.replace(
      "{agents}",
      available.map((a) => `- ${a.name}: ${a.description ?? "No description"}`).join("\n"),
    ),
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const target = await Agent.get(params.agent)
      validate(target, params.agent, ctx.agent, available)
      await ctx.ask({
        permission: "switch_agent",
        patterns: [params.agent],
        always: ["*"],
        metadata: { agent: params.agent, reason: params.reason },
      })
      await switchMessage(params.agent, params.reason, ctx.sessionID)
      return {
        title: `Switching to ${params.agent} agent`,
        output: `User approved switching to ${params.agent} agent. Wait for further instructions.`,
        metadata: {},
      }
    },
  }
})
