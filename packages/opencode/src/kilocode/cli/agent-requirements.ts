import type { AgentRequirementResult } from "@kilocode/sdk/v2"
import { isRecord } from "@/util/record"

type Item = AgentRequirementResult["skills"][number] | AgentRequirementResult["mcps"][number]

export type Client = {
  kilocode: {
    agentRequirements: (
      parameters: { agent: string; directory: string },
      options: { throwOnError: true },
    ) => Promise<{ data: AgentRequirementResult }>
  }
}

export type ErrorData = {
  message: string
  agent: string
  directory: string
  state: "blocked" | "error"
  skills: AgentRequirementResult["skills"]
  mcps: AgentRequirementResult["mcps"]
  vscode_extensions: AgentRequirementResult["vscode_extensions"]
}

export type RequirementError = {
  name: "AgentRequirementError"
  data: ErrorData
}

export type Check =
  | { ok: true; result: AgentRequirementResult }
  | { ok: false; result: AgentRequirementResult; error: RequirementError }

export async function check(input: { client: Client; agent: string; directory: string }): Promise<Check> {
  const response = await input.client.kilocode.agentRequirements(
    { agent: input.agent, directory: input.directory },
    { throwOnError: true },
  )
  if (!blocked(response.data)) return { ok: true, result: response.data }
  return { ok: false, result: response.data, error: toError(response.data) }
}

export function blocked(result: AgentRequirementResult) {
  if (!result.enabled || result.state === "disabled") return false
  if (result.vscode_extensions.length > 0) return true
  return result.state === "blocked" || result.state === "error"
}

export function toError(result: AgentRequirementResult): RequirementError {
  const info = {
    message: result.error?.message ?? "Complete the required checks to use this agent first",
    agent: result.agent,
    directory: result.directory,
    state: result.state === "error" ? ("error" as const) : ("blocked" as const),
    skills: result.skills,
    mcps: result.mcps,
    vscode_extensions: result.vscode_extensions,
  }

  return {
    name: "AgentRequirementError",
    data: {
      ...info,
      message: format(info),
    },
  }
}

export function data(input: unknown): ErrorData | undefined {
  if (!isRecord(input)) return undefined
  if (input.name !== "AgentRequirementError" || !isRecord(input.data)) return undefined

  const info = input.data
  if (typeof info.message !== "string") return undefined
  if (typeof info.agent !== "string") return undefined
  if (typeof info.directory !== "string") return undefined
  if (info.state !== "blocked" && info.state !== "error") return undefined
  if (!Array.isArray(info.skills)) return undefined
  if (!Array.isArray(info.mcps)) return undefined
  if (!Array.isArray(info.vscode_extensions)) return undefined

  return info as ErrorData
}

export function format(input: ErrorData | RequirementError) {
  const info = "data" in input ? input.data : input
  const skills = pending(info.skills)
  const mcps = pending(info.mcps)
  const lines = [`Agent requirements are not met for "${info.agent}".`]

  if (info.vscode_extensions.length) {
    lines.push(
      "",
      "VS Code extensions:",
      ...info.vscode_extensions.map((ext) => `- ${ext.name} (${ext.id})`),
      "This agent requires VS Code extensions and is not supported in this CLI environment. Use the Kilo VS Code extension instead.",
    )
  }

  if (skills.length) lines.push("", "Skills:", ...skills.map((skill) => `- ${item(skill)}`))
  if (mcps.length) lines.push("", "MCP servers:", ...mcps.map((mcp) => `- ${item(mcp)}`))

  if (skills.length || mcps.length) {
    lines.push("", "Install the required skills and configure or connect the required MCP servers, then retry.")
  }
  return lines.join("\n")
}

function pending<T extends Item>(items: T[]) {
  return items.filter((item) => item.status !== "ready")
}

function item(input: Item) {
  const status = input.status === "missing" ? "missing" : "error"
  return input.message ? `${input.name} (${status}: ${input.message})` : `${input.name} (${status})`
}
