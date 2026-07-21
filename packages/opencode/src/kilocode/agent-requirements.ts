import type { Agent } from "@/agent/agent"
import type { Config } from "@/config/config"
import type { MCP } from "@/mcp"
import type { Skill } from "@/skill"
import { Flag } from "@opencode-ai/core/flag/flag"
import { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Effect, Exit, Schema } from "effect"
import { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"

export const VSCodeExtension = ConfigAgentV1.VSCodeExtension
export type VSCodeExtension = ConfigAgentV1.VSCodeExtension

export const Requirements = ConfigAgentV1.Requirements
export type Requirements = ConfigAgentV1.Requirements

export const SkillItem = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(["ready", "missing", "error"]),
  message: Schema.optional(Schema.String),
})
export type SkillItem = Schema.Schema.Type<typeof SkillItem>

export const MCPItem = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(["ready", "missing", "error"]),
  message: Schema.optional(Schema.String),
})
export type MCPItem = Schema.Schema.Type<typeof MCPItem>

export const Result = Schema.Struct({
  agent: Schema.String,
  directory: Schema.String,
  enabled: Schema.Boolean,
  state: Schema.Literals(["disabled", "ready", "blocked", "error"]),
  skills: Schema.Array(SkillItem),
  mcps: Schema.Array(MCPItem),
  vscode_extensions: Schema.Array(VSCodeExtension),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Literals(["unknown_agent", "malformed_declaration", "discovery_failed", "mcp_status_failed"]),
      message: Schema.String,
    }),
  ),
}).annotate({ identifier: "AgentRequirementResult" })
export type Result = Schema.Schema.Type<typeof Result>

export const BlockedError = NamedError.create("AgentRequirementError", {
  message: Schema.String,
  agent: Schema.String,
  directory: Schema.String,
  state: Schema.Literals(["blocked", "error"]),
  skills: Schema.mutable(Schema.Array(SkillItem)),
  mcps: Schema.mutable(Schema.Array(MCPItem)),
  vscode_extensions: Schema.mutable(Schema.Array(VSCodeExtension)),
})

type AgentInfo = Pick<Agent.Info, "name"> & { requirements?: unknown }

type Services = {
  config: Pick<Config.Interface, "get">
  agents: { get: (agent: string) => Effect.Effect<AgentInfo | undefined> }
  skills: Pick<Skill.Interface, "all">
  mcp: Pick<MCP.Interface, "status">
}

function enabled(cfg: Config.Info) {
  const experimental = cfg.experimental
  return experimental !== undefined && "agent_requirements" in experimental && experimental.agent_requirements === true
}

function ready(input: { agent: string; directory: string; enabled: boolean }): Result {
  return {
    ...input,
    state: input.enabled ? "ready" : "disabled",
    skills: [],
    mcps: [],
    vscode_extensions: [],
  }
}

function malformed(agent: AgentInfo, directory: string, message: string): Result {
  return {
    agent: agent.name,
    directory,
    enabled: true,
    state: "error",
    skills: [],
    mcps: [],
    vscode_extensions: [],
    error: { code: "malformed_declaration", message },
  }
}

function decode(agent: AgentInfo, directory: string): Requirements | Result {
  if (agent.requirements === undefined) return ready({ agent: agent.name, directory, enabled: true })

  const decoded = Schema.decodeUnknownExit(Requirements)(agent.requirements, {
    errors: "all",
    propertyOrder: "original",
  })
  if (Exit.isFailure(decoded)) return malformed(agent, directory, Cause.pretty(decoded.cause))
  return decoded.value
}

function item(name: string, status: MCP.Status | undefined): MCPItem {
  if (status?.status === "connected") return { name, status: "ready" }
  if (status?.status === "failed" || status?.status === "needs_client_registration") {
    return { name, status: "error", message: status.error }
  }
  return { name, status: "missing" }
}

export function evaluate(input: {
  agent: AgentInfo
  directory: string
  enabled: boolean
  requirements: Requirements
  discovered?: ReadonlySet<string>
  discoveryError?: string
  mcp?: Readonly<Record<string, MCP.Status>>
  mcpError?: string
}): Result {
  if (!input.enabled) return ready({ agent: input.agent.name, directory: input.directory, enabled: false })

  const skills = (input.requirements.skills ?? []).map((skill) => ({
    name: skill,
    status: input.discoveryError
      ? ("error" as const)
      : input.discovered?.has(skill)
        ? ("ready" as const)
        : ("missing" as const),
    ...(input.discoveryError ? { message: input.discoveryError } : {}),
  }))
  const mcps = (input.requirements.mcps ?? []).map((name) => {
    if (input.mcpError) return { name, status: "error" as const, message: input.mcpError }
    return item(name, input.mcp?.[name])
  })

  if (input.discoveryError) {
    return {
      agent: input.agent.name,
      directory: input.directory,
      enabled: true,
      state: "error",
      skills,
      mcps,
      vscode_extensions: input.requirements.vscode_extensions ?? [],
      error: { code: "discovery_failed", message: input.discoveryError },
    }
  }

  if (input.mcpError) {
    return {
      agent: input.agent.name,
      directory: input.directory,
      enabled: true,
      state: "error",
      skills,
      mcps,
      vscode_extensions: input.requirements.vscode_extensions ?? [],
      error: { code: "mcp_status_failed", message: input.mcpError },
    }
  }

  const valid = skills.every((skill) => skill.status === "ready") && mcps.every((mcp) => mcp.status === "ready")
  return {
    agent: input.agent.name,
    directory: input.directory,
    enabled: true,
    state: valid ? "ready" : "blocked",
    skills,
    mcps,
    vscode_extensions: input.requirements.vscode_extensions ?? [],
  }
}

export const status = Effect.fn("AgentRequirements.status")(function* (
  input: Services & { name: string; directory: string },
) {
  const cfg = yield* input.config.get()
  const active = enabled(cfg)
  if (!active) return ready({ agent: input.name, directory: input.directory, enabled: false })

  const agent = yield* input.agents.get(input.name)
  if (!agent) {
    return {
      agent: input.name,
      directory: input.directory,
      enabled: true,
      state: "error",
      skills: [],
      mcps: [],
      vscode_extensions: [],
      error: { code: "unknown_agent", message: `Agent not found: ${input.name}` },
    } satisfies Result
  }

  const requirements = decode(agent, input.directory)
  if ("state" in requirements) return requirements

  const skillStatus: Effect.Effect<Skill.Info[]> = requirements.skills?.length ? input.skills.all() : Effect.succeed([])
  const mcpStatus: Effect.Effect<Record<string, MCP.Status>> = requirements.mcps?.length
    ? input.mcp.status()
    : Effect.succeed({})
  const [discovered, mcp] = yield* Effect.all([skillStatus.pipe(Effect.exit), mcpStatus.pipe(Effect.exit)])
  const discoveredSet: ReadonlySet<string> | undefined = Exit.isSuccess(discovered)
    ? new Set(discovered.value.map((skill) => skill.name))
    : undefined

  if (Exit.isFailure(discovered)) {
    return evaluate({
      agent,
      directory: input.directory,
      enabled: active,
      requirements,
      discoveryError: Cause.pretty(discovered.cause),
      mcp: Exit.isSuccess(mcp) ? mcp.value : undefined,
    })
  }

  if (Exit.isFailure(mcp)) {
    return evaluate({
      agent,
      directory: input.directory,
      enabled: active,
      requirements,
      discovered: discoveredSet,
      mcpError: Cause.pretty(mcp.cause),
    })
  }

  return evaluate({
    agent,
    directory: input.directory,
    enabled: active,
    requirements,
    discovered: discoveredSet,
    mcp: mcp.value,
  })
})

export const guard = Effect.fn("AgentRequirements.guard")(function* (
  input: Services & { agent: AgentInfo; directory: string },
) {
  const result = yield* status({ ...input, name: input.agent.name })
  const unsupported = Flag.KILO_CLIENT !== "vscode" && result.vscode_extensions.length > 0
  if (result.state === "disabled" || (result.state === "ready" && !unsupported)) return
  const state = result.state === "error" ? result.state : "blocked"

  return yield* Effect.fail(
    new BlockedError({
      message: "Complete the required checks to use this agent first",
      agent: result.agent,
      directory: result.directory,
      state,
      skills: [...result.skills],
      mcps: [...result.mcps],
      vscode_extensions: [...result.vscode_extensions],
    }),
  )
})
