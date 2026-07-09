import type { Auth } from "@/auth"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "../message-v2"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { SystemPrompt } from "../system"
import { USER_AGENT } from "@/installation" // kilocode_change
import { Effect, Record } from "effect"
import { jsonSchema, tool as aiTool, type ModelMessage, type Tool } from "ai"
import type { Plugin } from "@/plugin"
import { mergeDeep } from "remeda"
import { DEFAULT_HEADERS } from "@/kilocode/const" // kilocode_change
// kilocode_change start
import { getKiloProjectId } from "@/kilocode/project-id"
import {
  HEADER_FEATURE,
  HEADER_PARENT_TASKID,
  HEADER_PROJECTID,
  HEADER_MACHINEID,
  HEADER_TASKID,
} from "@kilocode/kilo-gateway"
import { Identity } from "@kilocode/kilo-telemetry"
import { KiloSession } from "@/kilocode/session"
import { stripInternalOptions } from "@/kilocode/agent/options"
// kilocode_change end

type PrepareInput = {
  readonly user: MessageV2.User
  readonly sessionID: string
  readonly parentSessionID?: string
  readonly model: Provider.Model
  readonly agent: Agent.Info
  readonly permission?: Permission.Ruleset
  readonly system: string[]
  readonly messages: ModelMessage[]
  readonly small?: boolean
  readonly tools: Record<string, Tool>
  readonly provider: Provider.Info
  readonly auth: Auth.Info | undefined
  readonly plugin: Plugin.Interface
  readonly flags: RuntimeFlags.Info
  readonly isWorkflow: boolean
}

export type Prepared = {
  readonly system: string[]
  readonly messages: ModelMessage[]
  readonly tools: Record<string, Tool>
  readonly params: {
    readonly temperature?: number
    readonly topP?: number
    readonly topK?: number
    readonly maxOutputTokens?: number
    readonly options: Record<string, any>
  }
  readonly messageTransformOptions: Record<string, any>
  readonly headers: Record<string, string>
}

const mergeOptions = (target: Record<string, any>, source: Record<string, any> | undefined): Record<string, any> =>
  mergeDeep(target, source ?? {}) as Record<string, any>

export const prepare = Effect.fn("LLMRequestPrep.prepare")(function* (input: PrepareInput) {
  const isOpenaiOauth = input.provider.id === "openai" && input.auth?.type === "oauth"
  const system = [
    [
      // kilocode_change start - soul defines core identity and personality
      ...(isOpenaiOauth ? [] : [SystemPrompt.soul()]),
      // kilocode_change end
      ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
      ...input.system,
      ...(input.user.system ? [input.user.system] : []),
    ]
      .filter((x) => x)
      .join("\n"),
  ]

  const header = system[0]
  yield* input.plugin.trigger(
    "experimental.chat.system.transform",
    { sessionID: input.sessionID, model: input.model },
    { system },
  )
  if (system.length > 2 && system[0] === header) {
    const rest = system.slice(1)
    system.length = 0
    system.push(header, rest.join("\n"))
  }

  const variant =
    !input.small && input.model.variants && input.user.model.variant
      ? input.model.variants[input.user.model.variant]
      : {}
  const base = input.small
    ? ProviderTransform.smallOptions(input.model)
    : ProviderTransform.options({
        model: input.model,
        sessionID: input.sessionID,
        providerOptions: input.provider.options,
      })
  // kilocode_change start - drop Kilo-internal agent metadata (id/displayName/source)
  // so it never leaks into providerOptions and gets rejected by strict providers
  const agentOptions = stripInternalOptions(input.agent.options)
  const options = mergeOptions(mergeOptions(mergeOptions(base, input.model.options), agentOptions), variant)
  // kilocode_change end
  if (isOpenaiOauth) {
    // kilocode_change start - prepend soul to instructions
    options.instructions = SystemPrompt.soul() + "\n" + system.join("\n")
    // kilocode_change end
  }

  const messages =
    isOpenaiOauth || input.isWorkflow
      ? input.messages
      : [
          ...system.map(
            (x): ModelMessage => ({
              role: "system",
              content: x,
            }),
          ),
          ...input.messages,
        ]

  const params = yield* input.plugin.trigger(
    "chat.params",
    {
      sessionID: input.sessionID,
      agent: input.agent.name,
      model: input.model,
      provider: input.provider,
      message: input.user,
    },
    {
      temperature: input.model.capabilities.temperature
        ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
        : undefined,
      topP: input.agent.topP ?? ProviderTransform.topP(input.model),
      topK: ProviderTransform.topK(input.model),
      // kilocode_change start - gpt-5 via @ai-sdk/openai-compatible proxies (e.g. LiteLLM)
      // rejects `max_tokens`; OpenAI requires `max_completion_tokens` and the compatible
      // SDK cannot rename the field, so drop the cap and let the upstream default apply.
      maxOutputTokens:
        input.model.api.npm === "@ai-sdk/openai-compatible" && input.model.api.id.toLowerCase().includes("gpt-5")
          ? undefined
          : ProviderTransform.maxOutputTokens(input.model, input.flags.outputTokenMax),
      // kilocode_change end
      options,
    },
  )

  const { headers } = yield* input.plugin.trigger(
    "chat.headers",
    {
      sessionID: input.sessionID,
      agent: input.agent.name,
      model: input.model,
      provider: input.provider,
      message: input.user,
    },
    {
      headers: {},
    },
  )

  // kilocode_change start - resolve project ID and machine ID for kilo provider
  const isKilo = input.model.api.npm === "@kilocode/kilo-gateway"
  const kiloProjectId = yield* isKilo
    ? Effect.promise(() => getKiloProjectId().catch(() => undefined))
    : Effect.succeed(undefined)
  const machineId = yield* isKilo
    ? Effect.promise(() => Identity.getMachineId().catch(() => undefined))
    : Effect.succeed(undefined)
  const parent = input.parentSessionID ?? KiloSession.resolveParent(input.sessionID)
  // kilocode_change end
  // kilocode_change start - attribute Kilo gateway usage to the root product session
  const attr = KiloSession.attribution(input.sessionID)
  // kilocode_change end

  const tools = resolveTools(input)
  if (
    input.model.providerID.includes("github-copilot") &&
    Object.keys(tools).length === 0 &&
    hasToolCalls(input.messages)
  ) {
    // Copilot needs a tools field when replaying prior tool calls, even if no tools are currently enabled.
    tools["_noop"] = aiTool({
      description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          reason: { type: "string", description: "Unused" },
        },
      }),
      execute: async () => ({ output: "", title: "", metadata: {} }),
    })
  }

  const kiloProjectID = input.model.providerID.startsWith("kilo") // kilocode_change
    ? (yield* InstanceState.context).project.id
    : undefined

  return {
    system,
    messages,
    tools: Object.fromEntries(Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b))),
    params,
    messageTransformOptions: options,
    headers: {
      ...(input.model.providerID.startsWith("kilo") // kilocode_change
        ? {
            ...(kiloProjectID ? { "x-kilo-project": kiloProjectID } : {}),
            "x-kilo-session": input.sessionID,
            "x-kilo-request": input.user.id,
            "x-kilo-client": input.flags.client,
            "User-Agent": USER_AGENT,
          }
        : {
            "x-session-affinity": input.sessionID,
            ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
            "User-Agent": USER_AGENT,
            ...(input.model.providerID !== "anthropic" ? DEFAULT_HEADERS : undefined), // kilocode_change
          }),
      // kilocode_change start - headers for kilo provider
      ...(isKilo && input.agent.name ? { "x-kilocode-mode": input.agent.name.toLowerCase() } : {}),
      ...(isKilo && kiloProjectId ? { [HEADER_PROJECTID]: kiloProjectId } : {}),
      ...(isKilo && machineId ? { [HEADER_MACHINEID]: machineId } : {}),
      ...(isKilo ? { [HEADER_TASKID]: input.sessionID } : {}),
      ...(isKilo && parent ? { [HEADER_PARENT_TASKID]: parent } : {}),
      ...(isKilo && attr.feature ? { [HEADER_FEATURE]: attr.feature } : {}),
      // kilocode_change end
      ...input.model.headers,
      ...headers,
    },
  }
})

function resolveTools(input: Pick<PrepareInput, "tools" | "agent" | "permission" | "user">) {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}

export function hasToolCalls(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}

export * as LLMRequestPrep from "./request"
