import { query } from "@anthropic-ai/claude-agent-sdk"
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk"
import { bridgeMessages } from "@/devilcode/agent-sdk-bridge"
import { createDevilToolServer } from "@/devilcode/agent-sdk-tools"
import { buildPrompt } from "@/devilcode/claude-code"
import type { ModelMessage, StreamTextResult, ToolSet } from "ai"
import type { Agent } from "@/agent/agent"
import { PermissionNext } from "@/permission/next"
import type { Tool } from "@/tool/tool"
import { createRequire } from "node:module"
import path from "node:path"
import { which } from "@/util/which"

type Output = Pick<StreamTextResult<ToolSet, unknown>, "fullStream" | "textStream" | "text">

export const AGENT_SDK_ID = "agent-sdk"
export const AGENT_SDK_RUNTIME = "external-agent"

/**
 * Resolve the Claude Code executable path.
 *
 * Prefers the system-installed `claude` binary (which carries the user's
 * subscription auth). Falls back to the SDK's bundled cli.js.
 *
 * Bun's hoisted node_modules layout breaks the SDK's internal cli.js
 * resolution on Windows, so we always try the system binary first.
 */
function resolveClaudeCodeExecutable(): string | undefined {
  // Prefer system claude binary — it has subscription auth baked in
  const bin = which("claude")
  if (bin) return bin

  // Fallback: SDK's bundled cli.js
  try {
    const require = createRequire(import.meta.url)
    const sdkEntry = require.resolve("@anthropic-ai/claude-agent-sdk")
    return path.join(path.dirname(sdkEntry), "cli.js")
  } catch {
    return undefined
  }

  return undefined
}

const MODEL_MAP: Record<string, string> = {
  "opus-4-6": "claude-opus-4-6",
  "sonnet-4-6": "claude-sonnet-4-6",
  "haiku-4-5": "claude-haiku-4-5",
}

function model(id: string, name: string, family: string, output: number, costIn: number, costOut: number, context = 200000) {
  return {
    id,
    name,
    family,
    release_date: "2026-04-04",
    attachment: true,
    reasoning: true,
    temperature: false,
    tool_call: false,
    limit: {
      context,
      output,
    },
    cost: {
      input: costIn,
      output: costOut,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    options: {
      runtime: AGENT_SDK_RUNTIME,
    },
    provider: {
      api: "https://api.anthropic.com/",
      npm: "@anthropic-ai/claude-agent-sdk",
    },
  }
}

export function provider() {
  return {
    id: AGENT_SDK_ID,
    name: "Claude (Agent SDK)",
    env: [], // No env required — uses Claude Code subscription auth OR ANTHROPIC_API_KEY
    api: "https://api.anthropic.com/",
    npm: "@anthropic-ai/claude-agent-sdk",
    models: {
      "opus-4-6": model("opus-4-6", "Claude Opus 4.6 (1M)", "claude-opus", 128000, 5, 25, 1000000),
      "sonnet-4-6": model("sonnet-4-6", "Claude Sonnet 4.6 (1M)", "claude-sonnet", 64000, 3, 15, 1000000),
      "haiku-4-5": model("haiku-4-5", "Claude Haiku 4.5", "claude-haiku", 64000, 1, 5),
    },
  }
}

const TOOLS = [
  { tool: "Read", permission: "read" },
  { tool: "Glob", permission: "glob" },
  { tool: "Grep", permission: "grep" },
  { tool: "WebFetch", permission: "webfetch" },
  { tool: "WebSearch", permission: "websearch" },
  { tool: "Bash", permission: "bash" },
  { tool: "Edit", permission: "edit" },
  { tool: "Write", permission: "edit" },
  { tool: "Agent", permission: "task" },
] as const

function access(permission: string, ruleset: NonNullable<Agent.Info["permission"]>) {
  const rule = PermissionNext.evaluate(permission, "*", ruleset)
  if (permission !== "bash" || rule.action !== "deny") return rule.action
  const allowed = ruleset.some(
    (item) => item.pattern !== "*" && PermissionNext.evaluate(permission, item.pattern, [item]).action === "allow",
  )
  if (allowed) return "allow"
  return "deny"
}

export function mapPermissions(agent?: { permission?: Agent.Info["permission"] }): {
  permissionMode: string
  allowedTools: string[]
  disallowedTools: string[]
} {
  const defaultAllowed = ["Read", "Glob", "Grep", "WebFetch", "WebSearch"]

  if (!agent?.permission) {
    return {
      permissionMode: "acceptEdits",
      allowedTools: defaultAllowed,
      disallowedTools: [],
    }
  }

  const allowedTools: string[] = []
  const disallowedTools: string[] = []
  let hasAllow = false
  let hasDeny = false

  for (const item of TOOLS) {
    const rule = access(item.permission, agent.permission)
    if (rule === "allow") {
      allowedTools.push(item.tool)
      hasAllow = true
    }
    if (rule === "deny") {
      disallowedTools.push(item.tool)
      hasDeny = true
    }
  }

  let permissionMode: string
  if (hasDeny && !hasAllow) {
    permissionMode = "plan"
  } else {
    permissionMode = "acceptEdits"
  }

  return { permissionMode, allowedTools, disallowedTools }
}

export function stream(input: {
  abort: AbortSignal
  cwd: string
  messages: ModelMessage[]
  small: boolean
  system: string[]
  model: string
  agent?: Pick<Agent.Info, "permission">
  tools?: Tool.Info[]
}): Output {
  const prompt = buildPrompt({ messages: input.messages, system: input.system })
  const resolvedModelId = MODEL_MAP[input.model] ?? input.model

  async function* generate() {
    const mcpServers: Record<string, McpServerConfig> = {}

    if (input.tools && input.tools.length > 0) {
      const server = await createDevilToolServer(input.tools)
      mcpServers["devil-tools"] = server
    }

    const abortController = new AbortController()
    const onAbort = () => abortController.abort()
    input.abort.addEventListener("abort", onAbort, { once: true })

    try {
      const permissions = mapPermissions(input.agent)

      const cliPath = resolveClaudeCodeExecutable()

      const q = query({
        prompt,
        options: {
          abortController,
          cwd: input.cwd,
          model: resolvedModelId,
          ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
          permissionMode: permissions.permissionMode as "acceptEdits" | "plan",
          allowedTools: permissions.allowedTools,
          mcpServers,
          maxTurns: input.small ? 1 : 50,
          systemPrompt: {
            type: "preset" as const,
            preset: "claude_code" as const,
            append: input.system.join("\n\n"),
          },
          thinking: { type: "adaptive" as const },
          betas: ["context-1m-2025-08-07"],
        },
      })

      for await (const message of q) {
        yield message
      }
    } finally {
      input.abort.removeEventListener("abort", onAbort)
    }
  }

  return bridgeMessages(generate())
}
