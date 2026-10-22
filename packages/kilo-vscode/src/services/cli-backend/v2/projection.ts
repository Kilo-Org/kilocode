// Projects Kilo v2 server shapes onto the v1 SDK shapes that the extension and webviews render.
import type {
  Agent,
  AssistantMessage,
  Config,
  FilePart,
  Message,
  Model,
  Part,
  PermissionRequest as V1Permission,
  Provider,
  QuestionRequest,
  Session,
  ToolState,
  UserMessage,
} from "@kilocode/sdk-v1/v2/client"
import type {
  AgentInfo,
  ConfigEntry,
  FormInfo,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  ProviderInfo,
  SessionInfo,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionStructuredError,
  TokenUsageInfo,
  ToolContent,
} from "@opencode/client"

export function sessionView(session: SessionInfo): Session {
  return {
    id: session.id,
    slug: session.id,
    version: "v2",
    projectID: session.projectID,
    directory: session.location.directory,
    parentID: session.parentID,
    title: session.title ?? "",
    agent: session.agent,
    model: session.model,
    cost: session.cost,
    tokens: session.tokens,
    metadata: session.metadata,
    time: { created: session.time.created, updated: session.time.updated, archived: session.time.archived },
  }
}

export function modelView(info: ModelInfo): Model {
  const base = info.cost.find((cost) => !cost.tier)
  const tiers = info.cost.flatMap((cost) =>
    cost.tier
      ? [
          {
            input: cost.input,
            output: cost.output,
            cache: { read: cost.cache.read, write: cost.cache.write },
            tier: cost.tier,
          },
        ]
      : [],
  )
  const input = info.capabilities.input
  const output = info.capabilities.output
  const has = (list: string[], kind: string) => list.includes(kind)
  return {
    id: info.id,
    providerID: info.providerID,
    api: { id: info.modelID, url: "", npm: info.package ?? "" },
    name: info.name,
    family: info.family,
    capabilities: {
      temperature: true,
      reasoning: has(output, "reasoning") || has(input, "reasoning") || info.variants.length > 0,
      attachment: input.some((kind) => kind !== "text"),
      toolcall: info.capabilities.tools,
      input: {
        text: has(input, "text"),
        audio: has(input, "audio"),
        image: has(input, "image"),
        video: has(input, "video"),
        pdf: has(input, "pdf"),
      },
      output: {
        text: has(output, "text"),
        audio: has(output, "audio"),
        image: has(output, "image"),
        video: has(output, "video"),
        pdf: has(output, "pdf"),
      },
      interleaved: false,
    },
    cost: {
      input: base?.input ?? 0,
      output: base?.output ?? 0,
      cache: { read: base?.cache.read ?? 0, write: base?.cache.write ?? 0 },
      tiers: tiers.length ? tiers : undefined,
    },
    limit: info.limit,
    status: info.status,
    // Settings can carry credentials; the webview does not need them.
    options: {},
    headers: {},
    release_date: info.time.released ? new Date(info.time.released).toISOString() : "",
    variants: info.variants.length
      ? Object.fromEntries(info.variants.map((variant) => [variant.id, { ...variant.settings }]))
      : undefined,
  }
}

export function providerView(info: ProviderInfo, models: Record<string, Model>): Provider {
  return {
    id: info.id,
    name: info.name,
    source: info.activation === "auto" ? "api" : "config",
    env: [],
    options: {},
    models,
  }
}

export function providersView(input: { providers: ProviderInfo[]; models: ModelInfo[]; fallback: ModelInfo | null }) {
  const models = new Map<string, Record<string, Model>>()
  for (const model of input.models) {
    if (!model.enabled) continue
    const list = models.get(model.providerID) ?? {}
    list[model.id] = modelView(model)
    models.set(model.providerID, list)
  }
  // The provider list can lag the model list while the server warms up; keep every provider that has models.
  const known = new Set(input.providers.map((provider) => provider.id))
  const providers: ProviderInfo[] = [
    ...input.providers.filter((provider) => provider.activation !== "disabled"),
    ...[...models.keys()]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: id, activation: "enabled" as const, package: "" })),
  ]
  return {
    all: providers.map((provider) => providerView(provider, models.get(provider.id) ?? {})),
    default: input.fallback ? { [input.fallback.providerID]: input.fallback.id } : {},
    connected: providers.filter((provider) => models.has(provider.id)).map((provider) => provider.id),
    failed: [],
    failures: [],
  }
}

export function agentView(info: AgentInfo): Agent {
  return {
    name: info.id,
    displayName: info.name,
    description: info.description,
    mode: info.mode,
    native: true,
    hidden: info.hidden,
    color: typeof info.color === "string" ? info.color : undefined,
    steps: info.steps,
    permission: info.permissions.map((rule) => ({
      permission: rule.action,
      pattern: rule.resource,
      action: rule.effect,
    })),
    model: info.model ? { modelID: info.model.id, providerID: info.model.providerID } : undefined,
    prompt: info.system,
    options: {},
  }
}

export function permissionView(request: PermissionRequest): V1Permission {
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.action,
    patterns: request.resources,
    always: request.save ?? [],
    metadata: { ...request.metadata },
    tool: request.source ? { messageID: request.source.messageID, callID: request.source.id } : undefined,
  }
}

/** v2 asks questions as forms. The question tool produces string and multiselect fields. */
export function questionView(form: FormInfo): QuestionRequest {
  const tool = form.metadata?.tool as { messageID?: unknown; id?: unknown } | undefined
  return {
    id: form.id,
    sessionID: form.sessionID,
    blocking: true,
    tool:
      typeof tool?.messageID === "string" && typeof tool.id === "string"
        ? { messageID: tool.messageID, callID: tool.id }
        : undefined,
    questions: form.fields.map((field) => {
      const options = "options" in field && Array.isArray(field.options) ? field.options : []
      return {
        header: field.title ?? form.title,
        question: field.description ?? field.title ?? form.title,
        options: options.map((option: { label: string; description?: string }) => ({
          label: option.label,
          description: option.description ?? "",
        })),
        multiple: field.type === "multiselect",
        custom: ("custom" in field ? field.custom : undefined) ?? !options.length,
      }
    }),
  }
}

/** Merges the v2 config documents into the few v1 config keys that chat reads. */
export function configView(entries: ConfigEntry[]): Config {
  return entries.reduce<Config>((config, entry) => {
    if (entry.type !== "document") return config
    const model = entry.info.model
    return {
      ...config,
      ...(model && { model: typeof model === "string" ? model : `${model.providerID}/${model.model}` }),
      ...(entry.info.default_agent && { default_agent: entry.info.default_agent }),
      ...(entry.info.username && { username: entry.info.username }),
    }
  }, {})
}

/**
 * Part IDs sort in content order, because the webview sorts parts by ID when it reconciles a snapshot.
 * History and live events use the same IDs, so a reload replaces streamed parts instead of adding copies.
 */
export const partID = {
  start: (message: string) => `${message}:0000`,
  content: (message: string, index: number) => `${message}:${String(index + 1).padStart(4, "0")}`,
  finish: (message: string) => `${message}:~`,
}

export type Item = { info: Message; parts: Part[] }

/** Session context that v2 messages do not repeat on every record. */
export type Context = { sessionID: string; directory: string; agent?: string; model?: ModelRef }

const usage = (tokens?: TokenUsageInfo) => ({
  input: tokens?.input ?? 0,
  output: tokens?.output ?? 0,
  reasoning: tokens?.reasoning ?? 0,
  cache: { read: tokens?.cache.read ?? 0, write: tokens?.cache.write ?? 0 },
})

export function errorView(error: SessionStructuredError): NonNullable<AssistantMessage["error"]> {
  if (/abort|interrupt/i.test(error.type)) return { name: "MessageAbortedError", data: { message: error.message } }
  return { name: "UnknownError", data: { message: error.message } }
}

export function userView(
  ctx: Context,
  input: { id: string; created: number; text: string; metadata?: Record<string, unknown> },
  files: Array<{ uri?: string; mime: string; name?: string | null }> = [],
): Item {
  const info: UserMessage = {
    id: input.id,
    sessionID: ctx.sessionID,
    role: "user",
    time: { created: input.created },
    agent: ctx.agent ?? "",
    model: { providerID: ctx.model?.providerID ?? "", modelID: ctx.model?.id ?? "", variant: ctx.model?.variant },
  }
  const text: Part = {
    id: partID.content(input.id, 0),
    sessionID: ctx.sessionID,
    messageID: input.id,
    type: "text",
    text: input.text,
    metadata: input.metadata,
  }
  const attachments = files.map(
    (file, index): Part => ({
      id: partID.content(input.id, index + 1),
      sessionID: ctx.sessionID,
      messageID: input.id,
      type: "file",
      mime: file.mime,
      filename: file.name ?? undefined,
      url: file.uri ?? "",
    }),
  )
  return { info, parts: [text, ...attachments] }
}

export function assistantView(
  ctx: Context & { parentID: string },
  input: {
    id: string
    agent: string
    model: ModelRef
    created: number
    completed?: number
    cost?: number
    tokens?: TokenUsageInfo
    finish?: string
    error?: SessionStructuredError
  },
): AssistantMessage {
  return {
    id: input.id,
    sessionID: ctx.sessionID,
    role: "assistant",
    time: { created: input.created, completed: input.completed },
    error: input.error ? errorView(input.error) : undefined,
    parentID: ctx.parentID,
    modelID: input.model.id,
    providerID: input.model.providerID,
    variant: input.model.variant,
    mode: input.agent,
    agent: input.agent,
    path: { cwd: ctx.directory, root: ctx.directory },
    cost: input.cost ?? 0,
    tokens: usage(input.tokens),
    finish: input.finish,
  }
}

function output(content: ToolContent[] | undefined) {
  return (content ?? []).flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
}

function attachments(ctx: Context, message: string, content: ToolContent[] | undefined): FilePart[] {
  return (content ?? []).flatMap((item, index) =>
    item.type === "file"
      ? [
          {
            id: `${message}:file:${index}`,
            sessionID: ctx.sessionID,
            messageID: message,
            type: "file" as const,
            mime: item.mime,
            filename: item.name ?? undefined,
            url: item.uri,
          },
        ]
      : [],
  )
}

/** v1 tool names that v2 renamed. The v1 tool renderers in kilo-ui choose their layout by name. */
const TOOLS: Record<string, string> = { shell: "bash", patch: "apply_patch", subagent: "task" }

export function toolName(name: string): string {
  return TOOLS[name] ?? name
}

/** v1 input field names for the v2 tools that renamed them (`path` was `filePath`, and so on). */
export function toolInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if ((name === "read" || name === "edit" || name === "write") && "path" in input)
    return { ...input, filePath: input.path }
  if (name === "skill" && "id" in input) return { ...input, name: input.id }
  if (name === "subagent") return { ...input, subagent_type: input.agent, task_id: input.sessionID }
  return input
}

export function toolStateView(ctx: Context, message: string, tool: SessionMessageAssistantTool): ToolState {
  const state = tool.state.status === "streaming" ? tool.state : { ...tool.state, input: toolInput(tool.name, tool.state.input) }
  const start = tool.time.ran ?? tool.time.created
  const end = tool.time.completed ?? start
  if (state.status === "streaming") return { status: "pending", input: {}, raw: state.input }
  const title = typeof state.metadata?.title === "string" ? state.metadata.title : undefined
  if (state.status === "running")
    return { status: "running", input: state.input, title, metadata: state.metadata, time: { start } }
  if (state.status === "completed")
    return {
      status: "completed",
      input: state.input,
      output: output(state.content),
      title: title ?? tool.name,
      metadata: { ...state.metadata },
      time: { start, end },
      attachments: attachments(ctx, message, state.content),
    }
  return {
    status: "error",
    input: state.input,
    error: state.error.message,
    metadata: state.metadata,
    time: { start, end },
  }
}

/** Projects one page of v2 session messages (oldest first) onto v1 messages with parts. */
export function messagesView(start: Context, list: SessionMessageInfo[]): Item[] {
  const ctx = { ...start }
  const items: Item[] = []
  const parent = { id: "" }
  for (const message of list) {
    if (message.type === "agent-switched") {
      ctx.agent = message.agent
      continue
    }
    if (message.type === "model-switched") {
      ctx.model = message.model
      continue
    }
    if (message.type === "user") {
      parent.id = message.id
      items.push(
        userView(
          ctx,
          { id: message.id, created: message.time.created, text: message.text, metadata: message.metadata },
          message.files?.map((file) => ({
            uri: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
            mime: file.mime,
            name: file.name,
          })),
        ),
      )
      continue
    }
    if (message.type !== "assistant") continue
    const info = assistantView(
      { ...ctx, parentID: parent.id },
      {
        id: message.id,
        agent: message.agent,
        model: message.model,
        created: message.time.created,
        completed: message.time.completed,
        cost: message.cost,
        tokens: message.tokens,
        finish: message.finish,
        error: message.error,
      },
    )
    const base = { sessionID: ctx.sessionID, messageID: message.id }
    const parts: Part[] = [{ ...base, id: partID.start(message.id), type: "step-start" }]
    for (const [index, item] of message.content.entries()) {
      const id = partID.content(message.id, index)
      if (item.type === "tool") {
        parts.push({
          ...base,
          id,
          type: "tool",
          callID: item.id,
          tool: toolName(item.name),
          state: toolStateView(ctx, message.id, item),
        })
        continue
      }
      const time = { start: message.time.created, end: message.time.completed ?? message.time.created }
      parts.push({ ...base, id, type: item.type, text: item.text, time })
    }
    if (message.time.completed)
      parts.push({
        ...base,
        id: partID.finish(message.id),
        type: "step-finish",
        reason: message.finish ?? "stop",
        cost: message.cost ?? 0,
        tokens: usage(message.tokens),
      })
    items.push({ info, parts })
  }
  return items
}
