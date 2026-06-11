import { Provider } from "@/provider/provider"
import * as Log from "@opencode-ai/core/util/log"
import { Context, Effect, Layer, Record } from "effect"
import * as Stream from "effect/Stream"
import {
  streamText,
  wrapLanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type Tool,
  tool,
  jsonSchema,
} from "ai"
import { mergeDeep } from "remeda"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { usable } from "./overflow" // kilocode_change
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Bus } from "@/bus"
import { Wildcard } from "@/util/wildcard"
import { SessionID } from "@/session/schema"
import { Auth } from "@/auth"
// kilocode_change start
import { DEFAULT_HEADERS } from "@/kilocode/const"
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
import { KiloLLM } from "@/kilocode/session/llm"
import { KiloSessionOverflow } from "@/kilocode/session/overflow"
import { SessionExport } from "@/kilocode/session-export"
import { getActiveOrg } from "@/kilocode/session-export/eligibility"
// kilocode_change end
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"

const log = Log.create({ service: "llm" })
export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX
type Result = Awaited<ReturnType<typeof streamText>>
type StreamResult = { fullStream: AsyncIterable<Event> }

// Avoid re-instantiating remeda's deep merge types in this hot LLM path; the runtime behavior is still mergeDeep.
const mergeOptions = (target: Record<string, any>, source: Record<string, any> | undefined): Record<string, any> =>
  mergeDeep(target, source ?? {}) as Record<string, any>

export type StreamInput = {
  user: MessageV2.User
  sessionID: string
  parentSessionID?: string
  model: Provider.Model
  agent: Agent.Info
  permission?: Permission.Ruleset
  system: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
  preflight?: boolean // kilocode_change - enable proactive threshold compaction for normal session turns
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export type Event = Result["fullStream"] extends AsyncIterable<infer T> ? T : never

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<Event, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM") {}

const live: Layer.Layer<
  Service,
  never,
  Auth.Service | Config.Service | Provider.Service | Plugin.Service | Permission.Service | RuntimeFlags.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service
    const flags = yield* RuntimeFlags.Service

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest) {
      const l = log
        .clone()
        .tag("providerID", input.model.providerID)
        .tag("modelID", input.model.id)
        .tag("session.id", input.sessionID)
        .tag("small", (input.small ?? false).toString())
        .tag("agent", input.agent.name)
        .tag("mode", input.agent.mode)
      l.info("stream", {
        modelID: input.model.id,
        providerID: input.model.providerID,
      })

      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID),
        ],
        { concurrency: "unbounded" },
      )
      // kilocode_change start - attribute Kilo gateway usage to the root product session
      const attr = KiloSession.attribution(input.sessionID)
      // kilocode_change end

      // TODO: move this to a proper hook
      const isOpenaiOauth = item.id === "openai" && info?.type === "oauth"

      const system: string[] = []
      system.push(
        [
          // kilocode_change start - soul defines core identity and personality
          ...(isOpenaiOauth ? [] : [SystemPrompt.soul()]),
          // kilocode_change end
          // use agent prompt otherwise provider prompt
          ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
          // any custom prompt passed into this call
          ...input.system,
          // any custom prompt from last user message
          ...(input.user.system ? [input.user.system] : []),
        ]
          .filter((x) => x)
          .join("\n"),
      )

      const header = system[0]
      yield* plugin.trigger(
        "experimental.chat.system.transform",
        { sessionID: input.sessionID, model: input.model },
        { system },
      )
      // rejoin to maintain 2-part structure for caching if header unchanged
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
            providerOptions: item.options,
          })
      const options = mergeOptions(mergeOptions(mergeOptions(base, input.model.options), input.agent.options), variant)
      if (isOpenaiOauth) {
        // kilocode_change start - prepend soul to instructions
        options.instructions = SystemPrompt.soul() + "\n" + system.join("\n")
        // kilocode_change end
      }

      const isWorkflow = language instanceof GitLabWorkflowLanguageModel
      const messages = isOpenaiOauth
        ? input.messages
        : isWorkflow
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

      const params = yield* plugin.trigger(
        "chat.params",
        {
          sessionID: input.sessionID,
          agent: input.agent.name,
          model: input.model,
          provider: item,
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
              : ProviderTransform.maxOutputTokens(input.model),
          // kilocode_change end
          options,
        },
      )

      const { headers } = yield* plugin.trigger(
        "chat.headers",
        {
          sessionID: input.sessionID,
          agent: input.agent.name,
          model: input.model,
          provider: item,
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
      // kilocode_change end

      const tools = resolveTools(input)

      // GitHub Copilot may require the tools parameter when message history contains
      // tool calls but no tools are active (e.g. compaction). Inject a stub tool that
      // is never meant to be invoked. LiteLLM-backed providers are excluded.
      if (
        input.model.providerID.includes("github-copilot") &&
        Object.keys(tools).length === 0 &&
        hasToolCalls(input.messages)
      ) {
        tools["_noop"] = tool({
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
      const sortedTools = Object.fromEntries(Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b)))

      // kilocode_change start - compact at the configured threshold before contacting the provider
      const estimated: ModelMessage[] =
        isOpenaiOauth || isWorkflow
          ? [
              {
                role: "system",
                content: isOpenaiOauth ? String(options.instructions ?? "") : system.join("\n"),
              },
              ...messages,
            ]
          : messages
      const preflight = input.preflight === true && KiloSessionOverflow.enabled({ cfg, model: input.model })
      const cap = KiloLLM.needsEstimate({ model: input.model, configured: params.maxOutputTokens })
      const usage =
        cap || preflight ? KiloSessionOverflow.measure({ messages: estimated, tools: sortedTools }) : undefined
      params.maxOutputTokens = KiloLLM.capOutputTokens({
        model: input.model,
        messages: estimated,
        tools: sortedTools,
        configured: params.maxOutputTokens,
        tokens: usage?.raw,
      })
      if (
        preflight &&
        usage &&
        KiloSessionOverflow.shouldCompact({
          cfg,
          model: input.model,
          usable: usable({ cfg, model: input.model }),
          tokens: usage.normalized,
          continuation: usage.continuation,
        })
      ) {
        return yield* Effect.fail(new KiloSessionOverflow.PreflightError())
      }
      // kilocode_change end

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
        }
        workflowModel.sessionID = input.sessionID
        workflowModel.systemPrompt = system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = sortedTools[toolName]
          if (!t || !t.execute) {
            return { result: "", error: `Unknown tool: ${toolName}` }
          }
          try {
            const result = await t.execute!(JSON.parse(argsJson), {
              toolCallId: _requestID,
              messages: input.messages,
              abortSignal: input.abort,
            })
            const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
            return {
              result: output,
              metadata: typeof result === "object" ? result?.metadata : undefined,
              title: typeof result === "object" ? result?.title : undefined,
            }
          } catch (e: any) {
            return { result: "", error: e.message ?? String(e) }
          }
        }

        const ruleset = Permission.merge(input.agent.permission ?? [], input.permission ?? [])
        workflowModel.sessionPreapprovedTools = Object.keys(sortedTools).filter((name) => {
          const match = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
          return !match || match.action !== "ask"
        })

        const bridge = yield* EffectBridge.make()
        const approvedToolsForSession = new Set<string>()
        workflowModel.approvalHandler = InstanceState.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          // Auto-approve tools that were already approved in this session
          // (prevents infinite approval loops for server-side MCP tools)
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }

          const id = PermissionID.ascending()
          let unsub: (() => void) | undefined
          try {
            unsub = Bus.subscribe(Permission.Event.Replied, (evt) => {
              if (evt.properties.requestID === id) void evt.properties.reply
            })
            const toolPatterns = approvalTools.map((t: { name: string; args: string }) => {
              try {
                const parsed = JSON.parse(t.args) as Record<string, unknown>
                const title = (parsed?.title ?? parsed?.name ?? "") as string
                return title ? `${t.name}: ${title}` : t.name
              } catch {
                return t.name
              }
            })
            const uniquePatterns = [...new Set(toolPatterns)] as string[]
            await bridge.promise(
              perm.ask({
                id,
                sessionID: SessionID.make(input.sessionID),
                permission: "workflow_tool_approval",
                patterns: uniquePatterns,
                metadata: { tools: approvalTools },
                always: uniquePatterns,
                ruleset: [],
              }),
            )
            for (const name of uniqueNames) approvedToolsForSession.add(name)
            workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
            return { approved: true }
          } catch {
            return { approved: false }
          } finally {
            unsub?.()
          }
        })
      }

      const tracer = cfg.experimental?.openTelemetry
        ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
        : undefined
      const telemetryTracer = tracer
        ? new Proxy(tracer, {
            get(target, prop, receiver) {
              if (prop !== "startSpan") return Reflect.get(target, prop, receiver)
              return (...args: Parameters<typeof target.startSpan>) => {
                const span = target.startSpan(...args)
                span.setAttribute("session.id", input.sessionID)
                return span
              }
            },
          })
        : undefined

      const instance = yield* InstanceState.context
      const opencodeProjectID = input.model.providerID.startsWith("opencode") ? instance.project.id : undefined

      // kilocode_change start - capture eligible session export request start
      const org = yield* isKilo && input.model.isFree === true
        ? Effect.promise(() => getActiveOrg())
        : Effect.succeed({ type: "unknown" as const })
      const started = Date.now()
      const parent = input.parentSessionID ?? KiloSession.resolveParent(input.sessionID)
      const found = KiloSession.resolveRoot(input.sessionID)
      const root = parent ? (found === input.sessionID ? parent : found) : input.sessionID
      const exportable =
        isKilo && input.model.isFree === true && org.type === "personal" && input.agent.name !== "title"
      if (exportable) {
        SessionExport.beforeRequest({
          input: { model: input.model, org },
          requestMeta: {
            sessionId: input.sessionID,
            rootSessionId: root,
            parentSessionId: parent,
            requestId: input.user.id,
            userMessageId: input.user.id,
            agent: input.agent.name,
            modeId: input.agent.mode,
            workspaceKey: instance.directory,
            agentInfo: SessionExport.agentInfo(input.agent),
          },
          assembled: {
            system,
            messages,
            tools,
            permissions: input.permission ?? [],
            toolChoice: input.toolChoice,
            params,
          },
        })
      }
      // kilocode_change end

      const result = streamText({
        // kilocode_change
        onError(error) {
          l.error("stream error", {
            error,
          })
        },
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.toLowerCase()
          if (lower !== failed.toolCall.toolName && sortedTools[lower]) {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired: lower,
            })
            return {
              ...failed.toolCall,
              toolName: lower,
            }
          }
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error.message,
            }),
            toolName: "invalid",
          }
        },
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        providerOptions: ProviderTransform.providerOptions(input.model, params.options),
        activeTools: Object.keys(sortedTools).filter((x) => x !== "invalid"),
        tools: sortedTools,
        toolChoice: input.toolChoice,
        maxOutputTokens: params.maxOutputTokens,
        abortSignal: input.abort,
        headers: {
          ...(input.model.providerID.startsWith("kilo") // kilocode_change
            ? {
                "x-kilo-project": opencodeProjectID,
                "x-kilo-session": input.sessionID,
                "x-kilo-request": input.user.id,
                "x-kilo-client": flags.client,
                "User-Agent": `opencode/${InstallationVersion}`,
              }
            : {
                "x-session-affinity": input.sessionID,
                ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
                "User-Agent": `opencode/${InstallationVersion}`,
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
        maxRetries: input.retries ?? 0,
        messages,
        model: wrapLanguageModel({
          model: language,
          middleware: [
            {
              specificationVersion: "v3" as const,
              async transformParams(args) {
                if (args.type === "stream") {
                  // @ts-expect-error
                  args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
                }
                return args.params
              },
            },
          ],
        }),
        // kilocode_change start - disable AI SDK span recording (ai.* / gen_ai.*)
        experimental_telemetry: { isEnabled: false },
      })
      // kilocode_change end
      // kilocode_change start - capture eligible session export request completion off the stream path
      if (!exportable) return { fullStream: result.fullStream } satisfies StreamResult
      return {
        fullStream: observeFullStreamForExport(result.fullStream, {
          sessionId: input.sessionID,
          rootSessionId: root,
          parentSessionId: parent,
          requestId: input.user.id,
          workspaceKey: instance.directory,
          started,
          retries: input.retries ?? 0,
        }),
      } satisfies StreamResult
      // kilocode_change end
    })

    const stream: Interface["stream"] = (input) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )

            const result = yield* run({ ...input, abort: ctrl.signal })

            return Stream.fromAsyncIterable(result.fullStream, (e) => (e instanceof Error ? e : new Error(String(e))))
          }),
        ),
      )

    return Service.of({ stream })
  }),
)

export const layer = live.pipe(Layer.provide(Permission.defaultLayer))

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
  ),
)

// kilocode_change start - session export stream observer
export function observeFullStreamForExport(
  stream: AsyncIterable<Event>,
  meta: {
    sessionId: string
    rootSessionId: string
    parentSessionId?: string
    requestId: string
    workspaceKey?: string
    started: number
    retries: number
  },
  complete: (args: Parameters<typeof SessionExport.afterRequest>[0]) => void = SessionExport.afterRequest,
): AsyncIterable<Event> {
  const textParts: string[] = []
  const reasoningParts: string[] = []
  const toolCalls: Event[] = []
  let finishReason: string | undefined
  let usage:
    | { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
    | undefined
  let finished = false
  let reported = false
  const done = (error?: unknown) => {
    if (reported) return
    reported = true
    try {
      complete({
        sessionId: meta.sessionId,
        rootSessionId: meta.rootSessionId,
        parentSessionId: meta.parentSessionId,
        requestId: meta.requestId,
        workspaceKey: meta.workspaceKey,
        output: { textParts, reasoningParts, toolCalls, finishReason, error, usage },
        durationMs: Date.now() - meta.started,
        retryCount: meta.retries,
      })
    } catch (err) {
      console.warn("[session-export] request completion export failed", err)
    }
  }
  const observed = async function* () {
    try {
      for await (const part of stream) {
        collectPart(part, {
          textParts,
          reasoningParts,
          toolCalls,
          setFinish: (val) => (finishReason = val),
          setUsage: (val) => (usage = val),
        })
        yield part
      }
      finished = true
    } catch (err) {
      done(err)
      throw err
    } finally {
      done(finished ? undefined : { code: "stream_cancelled" })
    }
  }
  return observed()
}

function collectPart(
  part: Event,
  out: {
    textParts: string[]
    reasoningParts: string[]
    toolCalls: Event[]
    setFinish: (value: string | undefined) => void
    setUsage: (
      value:
        | { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
        | undefined,
    ) => void
  },
): void {
  switch (part.type) {
    case "text-delta":
      if (part.text) out.textParts.push(part.text)
      return
    case "reasoning-delta":
      if (part.text) out.reasoningParts.push(part.text)
      return
    case "tool-input-start":
    case "tool-input-delta":
    case "tool-input-end":
    case "tool-call":
    case "tool-result":
    case "tool-error":
    case "tool-output-denied":
    case "tool-approval-request":
      out.toolCalls.push(part)
      return
    case "finish-step":
      out.setFinish(part.finishReason)
      out.setUsage(normalizeUsageForExport(part.usage))
      return
    case "finish":
      out.setFinish(part.finishReason)
      out.setUsage(normalizeUsageForExport(part.totalUsage))
      return
    default:
      return
  }
}

export function normalizeUsageForExport(value: Partial<LanguageModelUsage>) {
  const inputTokens = value.inputTokens ?? 0
  const outputTokens = value.outputTokens ?? 0
  const cacheReadTokens = value.inputTokenDetails?.cacheReadTokens ?? undefined
  const cacheWriteTokens = value.inputTokenDetails?.cacheWriteTokens ?? undefined
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
}
// kilocode_change end
function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">) {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}

// Check if messages contain any tool-call content
// Used to determine if a dummy tool should be added (GitHub Copilot only; see stream()).
export function hasToolCalls(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}

export * as LLM from "./llm"
