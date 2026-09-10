import { Agent } from "@/agent/agent"
import { KiloSessionPrompt } from "@/kilocode/session/prompt" // kilocode_change
import { GoalPolicy } from "@/kilocode/session/goal/policy" // kilocode_change
import { MemoryMarker } from "@/kilocode/memory/marker" // kilocode_change
import { BoardNotice } from "@/kilocode/board/notice" // kilocode_change
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { MCP } from "@/mcp"
import { McpCatalog } from "@/mcp/catalog"
import { Permission } from "@/permission"
import { Tool } from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"

import { Plugin } from "@/plugin"
import type { TaskPromptOps } from "@/tool/task"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { Effect } from "effect"
import { MessageV2 } from "./message-v2"
import { Session } from "./session"
import { SessionProcessor } from "./processor"
import { PartID } from "./schema"
import { EffectBridge } from "@/effect/bridge"
import * as SandboxPolicy from "@/kilocode/sandbox/policy" // kilocode_change
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
// kilocode_change start
import { Config } from "@/config/config"
import { PermissionProvenance } from "@/kilocode/permission/provenance"
import { McpApps } from "@/kilocode/mcp/apps"
import { InstanceState } from "@/effect/instance-state"
import { SecurityGate } from "@/kilocode/security/gate"
import { SecurityKeys } from "@/kilocode/security/keys"
import { ToolOrigin } from "@/kilocode/security/tool/origin"
import * as ToolNetwork from "@/kilocode/sandbox/network"
import type { SecurityDeniedError } from "@/kilocode/security/error"
import { SecuritySessionState } from "@/kilocode/security/state/store" // kilocode_change
import { KiloSession } from "@/kilocode/session" // kilocode_change
// kilocode_change end
import { isRecord } from "@/util/record"
import { RuntimeFlags } from "@/effect/runtime-flags"

// kilocode_change start: the security session-state layer keys state by the root session, so a
// sub-agent's sensitive read is visible to its parent. Resolve the root through Kilo's session graph,
// with the same defensive fallback the other consumers of that map use (session/llm.ts,
// session/compaction.ts): when the root map has no entry but the parent map does, the parent is the
// best available root. A child prompted in a process that never created it still resolves to itself —
// that gap needs a durable ancestry query and is recorded as a limitation.
SecuritySessionState.useRootResolver((id) => {
  const found = KiloSession.resolveRoot(id)
  if (found !== id) return found
  return KiloSession.resolveParent(id) ?? id
})
// kilocode_change end

const MCP_RESOURCE_TOOLS = {
  list: "list_mcp_resources",
  listTemplates: "list_mcp_resource_templates",
  read: "read_mcp_resource",
} as const
const MAX_MCP_RESOURCE_BLOB_BYTES = 10 * 1024 * 1024
const SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: Pick<SessionProcessor.Handle, "message" | "metadata" | "completeToolCall"> // kilocode_change
  bypassAgentCheck: boolean
  messages: SessionV1.WithParts[]
  promptOps: TaskPromptOps
  memoryCache: MemoryMarker.Cache // kilocode_change
  // kilocode_change start
  notify?: <T extends Tool.ExecuteResult>(tool: string, output: T, signal?: AbortSignal) => Effect.Effect<T>
  // kilocode_change end
}) {
  const tools: Record<string, AITool> = {}
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  // kilocode_change start
  const agents = yield* Agent.Service
  const sessions = yield* Session.Service
  // kilocode_change end
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const truncate = yield* Truncate.Service
  // kilocode_change start - permission provenance
  const config = yield* Config.Service
  const cfg = yield* config.get()
  const permissionOrigins = cfg.permission_origins
  const notify = cfg.experimental?.shared_agent_board === true ? input.notify : undefined
  type Output = Parameters<SessionProcessor.Handle["completeToolCall"]>[1]
  const finish = <T extends Output>(name: string, output: T, opts: ToolExecutionOptions) =>
    Effect.gen(function* () {
      const clean = BoardNotice.clean(output)
      if (notify && !opts.abortSignal?.aborted) {
        yield* input.processor.metadata(opts.toolCallId, { metadata: { output: clean.output } })
      }
      const result = yield* (notify?.(name, clean, opts.abortSignal) ?? Effect.succeed(clean)).pipe(
        Effect.onInterrupt(() => input.processor.completeToolCall(opts.toolCallId, clean)),
      )
      if (opts.abortSignal?.aborted) yield* input.processor.completeToolCall(opts.toolCallId, result)
      return result
    })
  // kilocode_change end
  const flags = yield* RuntimeFlags.Service
  const restricted = yield* SandboxPolicy.networkRestricted(input.session.id) // kilocode_change
  const sandboxed = (yield* SandboxPolicy.status(input.session.id)).enabled // kilocode_change
  // kilocode_change start - Security Auto Mode options resolved once per step (off by default)
  const instance = yield* InstanceState.context
  const security = yield* SecurityGate.options({
    config,
    sandboxed,
    workspace: { directory: instance.directory, worktree: instance.worktree },
  })
  // kilocode_change end
  // kilocode_change start - structural identity of the tool behind each call
  const toolInvocation = (item: object, id: string, args: unknown) =>
    SecurityGate.describe({ tool: id, provenance: ToolOrigin.provenance(item), args, options: security })

  const mcpInvocation = (entry: MCP.McpTool, key: string, args: unknown) => {
    const annotations = (entry.def as { annotations?: Record<string, unknown> }).annotations
    const hint = (name: string) =>
      typeof annotations?.[name] === "boolean" ? (annotations[name] as boolean) : undefined
    return SecurityGate.describe({
      tool: key,
      provenance: ToolOrigin.mcpProvenance(entry),
      args,
      options: security,
      mcp: { server: entry.clientName, tool: entry.def.name, remote: ToolOrigin.mcpProvenance(entry) === "mcp-remote" },
      hints: { readOnly: hint("readOnlyHint"), destructive: hint("destructiveHint"), openWorld: hint("openWorldHint") },
    })
  }

  /**
   * One lifecycle for the three MCP resource tools.
   *
   * They are Kilo built-ins, but the text they hand the agent is written outside Kilo, and they ask
   * for permission themselves — which is exactly the shape of a delegated MCP call. What they were
   * missing is the rest of that lifecycle: settling the session state on the text the agent actually
   * received (so a resource's words are part of the semantic context the *next* side-effecting action
   * is judged against), and turning a security denial into a structured result instead of a defect
   * that ends the turn.
   *
   * `SecurityGate.delegate` is that lifecycle, unchanged and shared with the MCP tool path below. The
   * built-in `SecurityGate.execute` envelope cannot stand in for it, for one reason: its ingest
   * attribution reads the *tool's* provenance, which for a Kilo built-in is `builtin`, so the
   * resource text would never be recorded. It is not about a second permission ask — all three are in
   * `ToolCapability.ASKING` and `execute` skips the envelope for those. Nothing here widens a
   * permission: the ask, its patterns and its metadata are untouched.
   */
  const resourceCall = <A extends { output: string }, E, R>(
    ctx: Tool.Context,
    name: string,
    /**
     * The part of the result the *server* wrote, or nothing when it returned no content. Kilo's own
     * "returned no contents" sentence is not untrusted text, and recording it would put a session
     * that read nothing into the semantic layer's routing for the rest of its life.
     */
    ingest: (value: A) => string | undefined,
    effect: Effect.Effect<A, E, R>,
  ) => {
    const denied = (error: SecurityDeniedError) => {
      const result = error.result(name)
      // No attachments on a denial: the read never happened.
      return { title: result.title, metadata: result.metadata, output: result.output, attachments: undefined }
    }
    return SecurityGate.delegate<A | ReturnType<typeof denied>, E, R>(
      // `output` is called on the success path only, so the denial shape never reaches `ingest`.
      { ctx, tool: name, options: security, output: (value) => ingest(value as A) },
      denied,
      effect,
    )
  }

  /**
   * Declared here rather than at its first use below, because the resource tools close over it and
   * code mode returns before that point. `{}` is the honest value there: it means "no live entry to
   * read", which is the case the configuration fallback in `resourceProvenance` already covers. A
   * `const` at its assignment left those closures reading a binding in its temporal dead zone, so
   * calling a resource tool under code mode threw instead of returning a listing.
   */
  let mcpTools: Record<string, MCP.McpTool> = {}

  /**
   * Provenance of the *content* a resource tool fetched. The tool is Kilo's; the words are the
   * server's, so the label follows the server — the same vocabulary the delegated MCP path uses, and
   * only where that path would have one (absent when the mode or the tool layer is off).
   */
  const resourceProvenance = (invocation: SecurityGate.Request["security"], servers: string[]) => {
    if (!invocation) return undefined
    // The live tool entry is the authority: `MCP.tools()` stamps the remote marker the delegated
    // path already judges by, and it covers servers registered at runtime, which the configuration
    // snapshot does not. The configuration is the fallback for a server that publishes resources but
    // no tools, where there is no entry to read; a runtime-added server of that shape is the one
    // remaining case that reads as local. The field is an audit label, never an input to a decision.
    const marked = (name: string) =>
      Object.entries(mcpTools).some(([key, entry]) => key.startsWith(`${name}_`) && ToolNetwork.isRemoteMcp(entry))
    const configured = (name: string) => {
      const entry = cfg.mcp?.[name]
      return entry !== undefined && "type" in entry && entry.type === "remote"
    }
    const remote = servers.some((name) => marked(name) || configured(name))
    return SecurityGate.resultProvenance({ provenance: remote ? "mcp-remote" : "mcp-local" })
  }
  // kilocode_change end

  // kilocode_change start - `invocation` carries the security identity of the call being made
  const context = (
    args: Record<string, unknown>,
    options: ToolExecutionOptions,
    invocation?: SecurityGate.Request["security"],
  ): Tool.Context => {
    // kilocode_change end
    const extra = {
      model: input.model,
      bypassAgentCheck: input.bypassAgentCheck,
      promptOps: input.promptOps,
      sandboxed, // kilocode_change
      security, // kilocode_change - lets a delegating tool build a descriptor for its real callee
      sandboxEscalation: false,
    }
    return {
      sessionID: input.session.id,
      abort: options.abortSignal!,
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      extra,
      agent: input.agent.name,
      messages: input.messages,
      // kilocode_change start
      metadata: (val) => input.processor.metadata(options.toolCallId, val),
      ask: (req) =>
        KiloSessionPrompt.askPermission({
          permission,
          agents,
          sessions,
          origins: permissionOrigins,
          agent: input.agent,
          session: input.session,
          request: {
            ...req,
            sessionID: input.session.id,
            tool: { messageID: input.processor.message.id, callID: options.toolCallId },
            // kilocode_change - a tool that delegates (code mode → MCP) names the real callee itself;
            // otherwise the identity of the tool being executed applies
            ...((req.security ?? invocation) ? { security: req.security ?? invocation } : {}),
          },
          security,
        }).pipe(
          // record why the call was allowed onto the tool part, then discard the outcome for the tool-facing ask
          Effect.tap((approval) =>
            Effect.gen(function* () {
              if (req.metadata?.["sandboxEscalation"] === true && approval.source === "manual") {
                extra.sandboxEscalation = true
              }
              yield* input.processor.metadata(options.toolCallId, {
                metadata: {
                  approval: PermissionProvenance.tagOutsideWorkspace(
                    approval,
                    req.permission,
                    PermissionProvenance.filepathOf(req.metadata),
                  ),
                },
              })
            }),
          ),
          // record the security decision behind a block so clients can explain it
          Effect.tapErrorTag("SecurityDeniedError", (err) =>
            input.processor.metadata(options.toolCallId, { metadata: { [SecurityKeys.META]: err.blocked() } }),
          ),
          // record why the call was denied too, so JSON exports and clients can explain the denial
          Effect.tapErrorTag("PermissionDeniedError", (err) =>
            input.processor.metadata(options.toolCallId, {
              metadata: {
                approval: PermissionProvenance.tagOutsideWorkspace(
                  PermissionProvenance.classifyDenial({
                    ruleset: err.ruleset,
                    permission: req.permission,
                    patterns: req.patterns,
                    agent: input.agent.name,
                    origins: permissionOrigins,
                  }),
                  req.permission,
                  PermissionProvenance.filepathOf(req.metadata),
                ),
              },
            }),
          ),
          Effect.asVoid,
          Effect.orDie,
        ),
    }
  }
  // kilocode_change end

  for (const item of yield* registry.tools({
    modelID: ModelV2.ID.make(input.model.api.id),
    providerID: input.model.providerID,
    family: input.model.family, // kilocode_change
    agent: input.agent,
    permission: input.session.permission,
    networkRestricted: restricted, // kilocode_change - let the registry suppress code-mode in restricted sessions
  })) {
    if (!GoalPolicy.available(input.session.id, item.id)) continue // kilocode_change
    const base = ToolJsonSchema.fromTool(item)
    const schema = ProviderTransform.schema(input.model, base)
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            // kilocode_change start - the descriptor is built from the registry's own markers, before
            // the plugin hook can touch the arguments, so a hook cannot change what the tool *is*
            const invocation = toolInvocation(item, item.id, args)
            const ctx = context(args, options, invocation)
            // kilocode_change end
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
              { args },
            )
            // kilocode_change start - the security gate runs inside the sandbox wrapper: it can only refuse or reshape the result
            const result = yield* SandboxPolicy.executeTool(
              ctx.sessionID,
              item,
              SecurityGate.execute({ ctx, tool: item.id, options: security, invocation }, item.execute(args, ctx)),
            )
            // kilocode_change end
            const provenance = SecurityGate.resultProvenance(invocation?.descriptor) // kilocode_change
            const output = {
              ...result,
              // kilocode_change start - audit foundation: mark results that came from outside Kilo
              ...(provenance ? { metadata: { ...result.metadata, [SecurityKeys.PROVENANCE]: provenance } } : {}),
              // kilocode_change end
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            // kilocode_change - mark successful targeted memory recalls for the assistant badge
            if (item.id === "kilo_memory_recall") MemoryMarker.recall({ result: output, cache: input.memoryCache }) // kilocode_change
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
              output,
            )
            return yield* finish(item.id, output, options) // kilocode_change
          }),
        )
      },
    })
  }

  const hasMcpResourceServer = Object.values(yield* mcp.clients()).some(
    (client) => !!client.getServerCapabilities()?.resources,
  )
  if (!restricted && hasMcpResourceServer) {
    tools[MCP_RESOURCE_TOOLS.list] = tool({
      description:
        "Lists resources provided by connected MCP servers. Resources provide context such as files, database schemas, or application-specific information.",
      inputSchema: jsonSchema(
        ProviderTransform.schema(input.model, {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: "Optional MCP server name. When omitted, lists resources from every connected server.",
            },
          },
          additionalProperties: false,
        }),
      ),
      execute(args, opts) {
        return run.promise(
          Effect.gen(function* () {
            const parsed = parseListMcpResourcesArgs(args)
            // kilocode_change start - identity of the delegated listing for the security decision
            const invocation = SecurityGate.describe({
              tool: MCP_RESOURCE_TOOLS.list,
              provenance: "builtin",
              args,
              options: security,
              ...(parsed.server ? { mcp: { server: parsed.server, tool: MCP_RESOURCE_TOOLS.list } } : {}),
            })
            const ctx = context(toRecord(args), opts, invocation)
            // kilocode_change end
            // kilocode_change start - the settlement lifecycle a delegated MCP tool already gets
            const output = yield* resourceCall(
              ctx,
              MCP_RESOURCE_TOOLS.list,
              (value) => (value.metadata.count > 0 ? value.output : undefined),
              Effect.gen(function* () {
                // kilocode_change end
                const clients = yield* mcp.clients()
                const resourceServers = Object.entries(clients)
                  .filter((entry) => !!entry[1].getServerCapabilities()?.resources)
                  .map((entry) => entry[0])
                  .sort((a, b) => a.localeCompare(b))
                if (parsed.server && !resourceServers.includes(parsed.server)) {
                  throw new Error(
                    resourceServers.length === 0
                      ? `MCP server "${parsed.server}" does not support resources`
                      : `MCP server "${parsed.server}" does not support resources. Available resource servers: ${resourceServers.join(", ")}`,
                  )
                }
                const permissionPatterns = parsed.server
                  ? [`mcp:${parsed.server}:*`]
                  : resourceServers.map((server) => `mcp:${server}:*`)
                yield* plugin.trigger(
                  "tool.execute.before",
                  { tool: MCP_RESOURCE_TOOLS.list, sessionID: ctx.sessionID, callID: opts.toolCallId },
                  { args },
                )
                yield* ctx.ask({
                  permission: "read",
                  metadata: parsed.server ? { server: parsed.server } : {},
                  patterns: permissionPatterns,
                  always: permissionPatterns,
                })

                const resources = Object.values(yield* mcp.resources(parsed.server))
                const filtered = resources
                  .filter((resource) => !parsed.server || resource.client === parsed.server)
                  .toSorted((a, b) =>
                    (a.client + "\u0000" + a.name + "\u0000" + a.uri).localeCompare(
                      b.client + "\u0000" + b.name + "\u0000" + b.uri,
                    ),
                  )
                const content = JSON.stringify({ resources: filtered.map(formatMcpResource) }, null, 2)
                const truncated = yield* truncate.output(content, {}, input.agent)
                // kilocode_change - the listing is the server's words, not Kilo's
                const provenance = resourceProvenance(invocation, parsed.server ? [parsed.server] : resourceServers)
                return {
                  title: parsed.server ? `MCP resources: ${parsed.server}` : "MCP resources",
                  metadata: {
                    count: filtered.length,
                    servers: resourceServers,
                    ...(parsed.server ? { server: parsed.server } : {}),
                    truncated: truncated.truncated,
                    ...(truncated.truncated && { outputPath: truncated.outputPath }),
                    ...(provenance ? { [SecurityKeys.PROVENANCE]: provenance } : {}), // kilocode_change
                  },
                  output: truncated.content,
                }
              }),
            ) // kilocode_change - end of the delegated-resource lifecycle wrapper
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: MCP_RESOURCE_TOOLS.list, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
              output,
            )
            return yield* finish(MCP_RESOURCE_TOOLS.list, output, opts) // kilocode_change
          }),
        )
      },
    })

    tools[MCP_RESOURCE_TOOLS.listTemplates] = tool({
      description:
        "Lists resource templates provided by connected MCP servers. Resource templates are parameterized resources that can be read after filling in their URI template.",
      inputSchema: jsonSchema(
        ProviderTransform.schema(input.model, {
          type: "object",
          properties: {
            server: {
              type: "string",
              description:
                "Optional MCP server name. When omitted, lists resource templates from every connected server.",
            },
          },
          additionalProperties: false,
        }),
      ),
      execute(args, opts) {
        return run.promise(
          Effect.gen(function* () {
            const parsed = parseListMcpResourcesArgs(args)
            // kilocode_change start - identity of the delegated listing for the security decision
            const invocation = SecurityGate.describe({
              tool: MCP_RESOURCE_TOOLS.listTemplates,
              provenance: "builtin",
              args,
              options: security,
              ...(parsed.server ? { mcp: { server: parsed.server, tool: MCP_RESOURCE_TOOLS.listTemplates } } : {}),
            })
            const ctx = context(toRecord(args), opts, invocation)
            // kilocode_change end
            // kilocode_change start - the settlement lifecycle a delegated MCP tool already gets
            const output = yield* resourceCall(
              ctx,
              MCP_RESOURCE_TOOLS.listTemplates,
              (value) => (value.metadata.count > 0 ? value.output : undefined),
              Effect.gen(function* () {
                // kilocode_change end
                const clients = yield* mcp.clients()
                const resourceServers = Object.entries(clients)
                  .filter((entry) => !!entry[1].getServerCapabilities()?.resources)
                  .map((entry) => entry[0])
                  .sort((a, b) => a.localeCompare(b))
                if (parsed.server && !resourceServers.includes(parsed.server)) {
                  throw new Error(
                    resourceServers.length === 0
                      ? `MCP server "${parsed.server}" does not support resources`
                      : `MCP server "${parsed.server}" does not support resources. Available resource servers: ${resourceServers.join(", ")}`,
                  )
                }
                const permissionPatterns = parsed.server
                  ? [`mcp:${parsed.server}:*`]
                  : resourceServers.map((server) => `mcp:${server}:*`)
                yield* plugin.trigger(
                  "tool.execute.before",
                  { tool: MCP_RESOURCE_TOOLS.listTemplates, sessionID: ctx.sessionID, callID: opts.toolCallId },
                  { args },
                )
                yield* ctx.ask({
                  permission: "read",
                  metadata: parsed.server ? { server: parsed.server } : {},
                  patterns: permissionPatterns,
                  always: permissionPatterns,
                })

                const templates = Object.values(yield* mcp.resourceTemplates(parsed.server))
                const filtered = templates
                  .filter((template) => !parsed.server || template.client === parsed.server)
                  .toSorted((a, b) =>
                    (a.client + "\u0000" + a.name + "\u0000" + a.uriTemplate).localeCompare(
                      b.client + "\u0000" + b.name + "\u0000" + b.uriTemplate,
                    ),
                  )
                const content = JSON.stringify({ resourceTemplates: filtered.map(formatMcpResourceTemplate) }, null, 2)
                const truncated = yield* truncate.output(content, {}, input.agent)
                // kilocode_change - the listing is the server's words, not Kilo's
                const provenance = resourceProvenance(invocation, parsed.server ? [parsed.server] : resourceServers)
                return {
                  title: parsed.server ? `MCP resource templates: ${parsed.server}` : "MCP resource templates",
                  metadata: {
                    count: filtered.length,
                    servers: resourceServers,
                    ...(parsed.server ? { server: parsed.server } : {}),
                    truncated: truncated.truncated,
                    ...(truncated.truncated && { outputPath: truncated.outputPath }),
                    ...(provenance ? { [SecurityKeys.PROVENANCE]: provenance } : {}), // kilocode_change
                  },
                  output: truncated.content,
                }
              }),
            ) // kilocode_change - end of the delegated-resource lifecycle wrapper
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: MCP_RESOURCE_TOOLS.listTemplates, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
              output,
            )
            return yield* finish(MCP_RESOURCE_TOOLS.listTemplates, output, opts) // kilocode_change
          }),
        )
      },
    })

    tools[MCP_RESOURCE_TOOLS.read] = tool({
      description:
        "Read a specific resource from an MCP server using the server name and resource URI. The URI is an MCP identifier and does not need to be a file URL.",
      inputSchema: jsonSchema(
        ProviderTransform.schema(input.model, {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: "MCP server name exactly as returned by list_mcp_resources.",
            },
            uri: {
              type: "string",
              description: "Resource URI to read. Use the exact URI string returned by list_mcp_resources.",
            },
          },
          required: ["server", "uri"],
          additionalProperties: false,
        }),
      ),
      execute(args, opts) {
        return run.promise(
          Effect.gen(function* () {
            const parsed = parseReadMcpResourceArgs(args)
            // kilocode_change start - server + resource URI reach the security decision, not just "read"
            const invocation = SecurityGate.describe({
              tool: MCP_RESOURCE_TOOLS.read,
              provenance: "builtin",
              args,
              options: security,
              mcp: { server: parsed.server, tool: MCP_RESOURCE_TOOLS.read, resource: parsed.uri },
            })
            const ctx = context(toRecord(args), opts, invocation)
            // kilocode_change end
            // kilocode_change start - the settlement lifecycle a delegated MCP tool already gets
            const output = yield* resourceCall(
              ctx,
              MCP_RESOURCE_TOOLS.read,
              (value) => (value.metadata.contents > 0 ? value.output : undefined),
              Effect.gen(function* () {
                // kilocode_change end
                const clients = yield* mcp.clients()
                const client = clients[parsed.server]
                if (!client) {
                  throw new Error(`MCP server "${parsed.server}" is not connected`)
                }
                if (!client.getServerCapabilities()?.resources) {
                  throw new Error(`MCP server "${parsed.server}" does not support resources`)
                }
                yield* plugin.trigger(
                  "tool.execute.before",
                  { tool: MCP_RESOURCE_TOOLS.read, sessionID: ctx.sessionID, callID: opts.toolCallId },
                  { args },
                )
                yield* ctx.ask({
                  permission: "read",
                  metadata: { server: parsed.server, uri: parsed.uri },
                  patterns: [`mcp:${parsed.server}:${parsed.uri}`],
                  always: [`mcp:${parsed.server}:*`],
                })

                const content = yield* mcp.readResource(parsed.server, parsed.uri)
                if (!content) throw new Error(`Failed to read MCP resource: ${parsed.server}/${parsed.uri}`)

                const formatted = formatMcpResourceContent(parsed.server, parsed.uri, content)
                const truncated = yield* truncate.output(formatted.text, {}, input.agent)
                // kilocode_change - the resource text is the server's words, not Kilo's
                const provenance = resourceProvenance(invocation, [parsed.server])
                return {
                  title: `MCP resource: ${parsed.uri}`,
                  metadata: {
                    server: parsed.server,
                    uri: parsed.uri,
                    contents: formatted.contents,
                    attachments: formatted.attachments.length,
                    truncated: truncated.truncated,
                    ...(truncated.truncated && { outputPath: truncated.outputPath }),
                    ...(provenance ? { [SecurityKeys.PROVENANCE]: provenance } : {}), // kilocode_change
                  },
                  output: truncated.content,
                  attachments: formatted.attachments.map((attachment) => ({
                    ...attachment,
                    id: PartID.ascending(),
                    sessionID: ctx.sessionID,
                    messageID: input.processor.message.id,
                  })),
                }
              }),
            ) // kilocode_change - end of the delegated-resource lifecycle wrapper
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: MCP_RESOURCE_TOOLS.read, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
              output,
            )
            return yield* finish(MCP_RESOURCE_TOOLS.read, output, opts) // kilocode_change
          }),
        )
      },
    })
  }

  if (flags.experimentalCodeMode) return tools

  mcpTools = restricted ? {} : yield* mcp.tools() // kilocode_change - assigned, declared above
  for (const [key, entry] of Object.entries(mcpTools)) {
    const item = McpCatalog.convertTool(entry.def, entry.client, entry.timeout)
    const execute = item.execute
    if (!execute) continue

    const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
    const transformed = ProviderTransform.schema(input.model, { ...schema, properties: schema.properties ?? {} })
    item.inputSchema = jsonSchema(transformed)
    // kilocode_change start - a security denial becomes a result the agent can read, not a defect that
    // ends the turn; the remote call itself never happens (the ask fails before `execute`)
    type McpResult = Awaited<ReturnType<NonNullable<typeof execute>>>
    const denied = (error: SecurityDeniedError) =>
      ({
        content: [{ type: "text", text: error.result(key).output }],
        metadata: { security: error.blocked() },
      }) as McpResult
    // kilocode_change end
    item.execute = (args, opts) =>
      run.promise(
        Effect.gen(function* () {
          // kilocode_change start - the MCP identity reaches the decision, not just the tool key
          const invocation = mcpInvocation(entry, key, args)
          const ctx = context(args, opts, invocation)
          // kilocode_change end
          // kilocode_change start - propagate MCP App UI metadata so hosts can preload the UI resource
          const mcpAppMeta = McpApps.toolMetadata(entry, flags)
          if (mcpAppMeta) {
            yield* input.processor.metadata(opts.toolCallId, { metadata: mcpAppMeta })
          }
          // kilocode_change end
          yield* plugin.trigger(
            "tool.execute.before",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
            { args },
          )
          // kilocode_change start
          const result: McpResult = yield* SandboxPolicy.executeMcp(
            ctx.sessionID,
            entry, // kilocode_change - retain the native entry's local/remote network authority marker
            // kilocode_change - the security gate wraps the delegated call the same way it wraps a
            // built-in one: settle the session state, and turn a denial into a structured result
            SecurityGate.delegate(
              {
                ctx,
                tool: key,
                options: security,
                // kilocode_change - the text the agent will actually receive, for content classification
                output: (value: McpResult) =>
                  value.content
                    ?.flatMap((item: { type: string; text?: string }) =>
                      item.type === "text" ? [item.text ?? ""] : [],
                    )
                    .join("\n"),
              },
              denied,
              Effect.gen(function* () {
                yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
                return yield* Effect.promise(() => execute(args, opts))
              }),
            ),
          ).pipe(
            // kilocode_change end
            Effect.withSpan("Tool.execute", {
              attributes: {
                "tool.name": key,
                "tool.call_id": opts.toolCallId,
                "session.id": ctx.sessionID,
                "message.id": input.processor.message.id,
              },
            }),
          )
          yield* plugin.trigger(
            "tool.execute.after",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
            result,
          )

          const textParts: string[] = []
          const attachments: Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">[] = []
          for (const contentItem of result.content) {
            if (contentItem.type === "text") textParts.push(contentItem.text)
            else if (contentItem.type === "image") {
              attachments.push({
                type: "file",
                mime: contentItem.mimeType,
                url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
              })
            } else if (contentItem.type === "resource") {
              const { resource } = contentItem
              if (resource.text) textParts.push(resource.text)
              if (resource.blob) {
                const mime = resource.mimeType ?? "application/octet-stream"
                const size = base64Size(resource.blob)
                if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mime)) {
                  textParts.push(
                    `[Binary MCP resource omitted: ${resource.uri} (${mime}, ${formatBytes(size)}) is not a supported attachment type]`,
                  )
                  continue
                }
                if (size > MAX_MCP_RESOURCE_BLOB_BYTES) {
                  textParts.push(
                    `[Binary MCP resource omitted: ${resource.uri} (${mime}, ${formatBytes(size)}) exceeds ${formatBytes(MAX_MCP_RESOURCE_BLOB_BYTES)}]`,
                  )
                  continue
                }
                attachments.push({
                  type: "file",
                  mime,
                  url: `data:${mime};base64,${resource.blob}`,
                  filename: resource.uri,
                })
              }
            }
          }

          const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
          const provenance = SecurityGate.resultProvenance(invocation?.descriptor) // kilocode_change
          const metadata = {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
            ...mcpAppMeta, // kilocode_change - MCP App UI metadata
            // kilocode_change start - audit foundation: this content came from an MCP server, not Kilo
            ...(provenance ? { [SecurityKeys.PROVENANCE]: provenance } : {}),
            // kilocode_change end
          }

          const output = {
            title: "",
            metadata,
            output: truncated.content,
            attachments: attachments.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
            content: result.content,
          }
          return yield* finish(key, output, opts) // kilocode_change
        }),
      )
    tools[key] = item
  }

  return tools
})

function toRecord(value: unknown) {
  if (isRecord(value)) return value
  return {}
}

function parseListMcpResourcesArgs(value: unknown) {
  const args = toRecord(value)
  return { server: optionalString(args, "server") }
}

function parseReadMcpResourceArgs(value: unknown) {
  const args = toRecord(value)
  return { server: requiredString(args, "server"), uri: requiredString(args, "uri") }
}

function optionalString(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string") throw new Error(`${key} must be a string`)
  return value
}

function requiredString(args: Record<string, unknown>, key: string) {
  const value = optionalString(args, key)
  if (value) return value
  throw new Error(`${key} is required`)
}

function formatMcpResource(resource: MCP.Resource) {
  const result = Object.fromEntries(Object.entries(resource).filter((entry) => entry[0] !== "client"))
  return { ...result, server: resource.client }
}

function formatMcpResourceTemplate(template: Record<string, unknown> & { client: string }) {
  const result = Object.fromEntries(Object.entries(template).filter((entry) => entry[0] !== "client"))
  return { ...result, server: template.client }
}

function formatMcpResourceContent(server: string, uri: string, content: { contents: unknown }) {
  const items = (Array.isArray(content.contents) ? content.contents : [content.contents]).filter(isRecord)
  const text: string[] = []
  const attachments: Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">[] = []

  for (const item of items) {
    const itemUri = typeof item.uri === "string" ? item.uri : uri
    const mime = typeof item.mimeType === "string" ? item.mimeType : "application/octet-stream"
    if (typeof item.text === "string") {
      text.push(`Resource: ${itemUri}\nMIME: ${mime}\n${item.text}`)
      continue
    }
    if (typeof item.blob === "string") {
      const size = base64Size(item.blob)
      if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mime)) {
        text.push(
          `[Binary MCP resource omitted: ${itemUri} (${mime}, ${formatBytes(size)}) is not a supported attachment type]`,
        )
        continue
      }
      if (size > MAX_MCP_RESOURCE_BLOB_BYTES) {
        text.push(
          `[Binary MCP resource omitted: ${itemUri} (${mime}, ${formatBytes(size)}) exceeds ${formatBytes(MAX_MCP_RESOURCE_BLOB_BYTES)}]`,
        )
        continue
      }
      text.push(`[Binary MCP resource attached: ${itemUri} (${mime})]`)
      attachments.push({
        type: "file",
        mime,
        url: `data:${mime};base64,${item.blob}`,
        filename: itemUri,
      })
      continue
    }
    text.push(`[MCP resource content without text or blob: ${itemUri}]`)
  }

  return {
    contents: items.length,
    attachments,
    text: text.join("\n\n") || `MCP resource ${uri} from ${server} returned no contents.`,
  }
}

function base64Size(value: string) {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

export * as SessionTools from "./tools"
