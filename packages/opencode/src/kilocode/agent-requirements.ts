import type { Agent } from "@/agent/agent"
import type { Config } from "@/config/config"
import type { Skill } from "@/skill"
import { Flag } from "@opencode-ai/core/flag/flag"
import { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Effect, Exit, Schema } from "effect"

const ID = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
)

const RequirementList = Schema.mutable(Schema.Array(ID)).check(Schema.isMinLength(1), Schema.isMaxLength(20))
const Extension = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  id: ID,
})
const ExtensionList = Schema.mutable(Schema.Array(Extension)).check(Schema.isMinLength(1), Schema.isMaxLength(20))

export const Requirements = Schema.Struct({
  skills: Schema.optional(RequirementList),
  vscode_extensions: Schema.optional(ExtensionList),
  mcps: Schema.optional(RequirementList),
}).check(
  Schema.makeFilter((input) => {
    const issues: Schema.FilterIssue[] = []
    if (!input.skills && !input.vscode_extensions && !input.mcps) {
      issues.push({ path: [], issue: "At least one requirement group is required" })
    }

    for (const group of ["skills", "mcps"] as const) {
      const seen = new Set<string>()
      for (const [index, value] of (input[group] ?? []).entries()) {
        if (seen.has(value)) issues.push({ path: [group, index], issue: `Duplicate ${group} requirement` })
        seen.add(value)
      }
    }

    const extensions = new Set<string>()
    for (const [index, extension] of (input.vscode_extensions ?? []).entries()) {
      if (extensions.has(extension.id)) {
        issues.push({ path: ["vscode_extensions", index], issue: "Duplicate vscode_extensions requirement" })
      }
      extensions.add(extension.id)
    }
    return issues
  }),
)
export type Requirements = Schema.Schema.Type<typeof Requirements>

export const Item = Schema.Struct({
  name: Schema.String,
  marketplace: Schema.String,
  status: Schema.Literals(["ready", "missing", "error"]),
  message: Schema.optional(Schema.String),
})
export type Item = Schema.Schema.Type<typeof Item>

export const Result = Schema.Struct({
  agent: Schema.String,
  directory: Schema.String,
  enabled: Schema.Boolean,
  state: Schema.Literals(["disabled", "ready", "blocked", "error"]),
  skills: Schema.Array(Item),
  vscode_extensions: Schema.Array(Extension),
  mcps: Schema.Array(Schema.String),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Literals(["unknown_agent", "malformed_declaration", "discovery_failed"]),
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
  skills: Schema.mutable(Schema.Array(Item)),
})

function ready(input: { agent: string; directory: string; enabled: boolean }): Result {
  return {
    ...input,
    state: input.enabled ? "ready" : "disabled",
    skills: [],
    vscode_extensions: [],
    mcps: [],
  }
}

function malformed(agent: Agent.Info, directory: string, message: string): Result {
  return {
    agent: agent.name,
    directory,
    enabled: true,
    state: "error",
    skills: [],
    vscode_extensions: [],
    mcps: [],
    error: { code: "malformed_declaration", message },
  }
}

// Validate the declaration and compare it with skills found in this directory.
export function evaluate(input: {
  agent: Agent.Info
  directory: string
  enabled: boolean
  discovered?: ReadonlySet<string>
  discoveryError?: string
}): Result {
  if (!input.enabled) return ready({ agent: input.agent.name, directory: input.directory, enabled: false })
  if (!input.agent.requirements) return ready({ agent: input.agent.name, directory: input.directory, enabled: true })

  const decoded = Schema.decodeUnknownExit(Requirements)(input.agent.requirements, {
    errors: "all",
    propertyOrder: "original",
  })
  if (Exit.isFailure(decoded)) return malformed(input.agent, input.directory, Cause.pretty(decoded.cause))

  if (input.discoveryError) {
    return {
      agent: input.agent.name,
      directory: input.directory,
      enabled: true,
      state: "error",
      skills: (decoded.value.skills ?? []).map((skill) => ({
        name: skill,
        marketplace: skill,
        status: "error",
        message: input.discoveryError,
      })),
      vscode_extensions: decoded.value.vscode_extensions ?? [],
      mcps: decoded.value.mcps ?? [],
      error: { code: "discovery_failed", message: input.discoveryError },
    }
  }

  // Skill names determine readiness; Marketplace IDs are only used for installation.
  const skills = (decoded.value.skills ?? []).map((skill) => ({
    name: skill,
    marketplace: skill,
    status: input.discovered?.has(skill) ? ("ready" as const) : ("missing" as const),
  }))
  return {
    agent: input.agent.name,
    directory: input.directory,
    enabled: true,
    state: skills.every((skill) => skill.status === "ready") ? "ready" : "blocked",
    skills,
    vscode_extensions: decoded.value.vscode_extensions ?? [],
    mcps: decoded.value.mcps ?? [],
  }
}

type Services = {
  config: Pick<Config.Interface, "get">
  agents: Pick<Agent.Interface, "get">
  skills: Pick<Skill.Interface, "all">
}

// Load scoped config, agent, and discovered skills for one status result.
export const status = Effect.fn("AgentRequirements.status")(function* (
  input: Services & { name: string; directory: string },
) {
  const cfg = yield* input.config.get()
  const enabled = cfg.experimental?.agent_requirements === true

  if (!enabled) return ready({ agent: input.name, directory: input.directory, enabled: false })

  const agent = yield* input.agents.get(input.name)
  if (!agent) {
    return {
      agent: input.name,
      directory: input.directory,
      enabled: true,
      state: "error",
      skills: [],
      vscode_extensions: [],
      mcps: [],
      error: { code: "unknown_agent", message: `Agent not found: ${input.name}` },
    } satisfies Result
  }

  const discovered = yield* input.skills.all().pipe(Effect.exit)
  if (Exit.isFailure(discovered)) {
    return evaluate({
      agent,
      directory: input.directory,
      enabled,
      discoveryError: Cause.pretty(discovered.cause),
    })
  }
  return evaluate({
    agent,
    directory: input.directory,
    enabled,
    discovered: new Set(discovered.value.map((skill) => skill.name)),
  })
})

export const guard = Effect.fn("AgentRequirements.guard")(function* (
  input: Services & { agent: Agent.Info; directory: string },
) {
  // Only VS Code enforces this gate because it provides the installation UI.
  if (Flag.KILO_CLIENT !== "vscode") return
  const result = yield* status({ ...input, name: input.agent.name })
  if (result.state === "disabled" || result.state === "ready") return
  return yield* Effect.die(
    new BlockedError({
      message: "Complete the required checks to use this agent first",
      agent: result.agent,
      directory: result.directory,
      state: result.state,
      skills: [...result.skills],
    }),
  )
})
