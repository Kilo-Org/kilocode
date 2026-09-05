import type { OpenCodeClient, SessionImportInput } from "@opencode-ai/client"
import type { SessionTransferData } from "@opencode-ai/client/promise"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { SessionTransfer } from "@opencode-ai/schema/session-transfer"
import { Schema } from "effect"
import { constants } from "node:fs"
import { open, stat } from "node:fs/promises"
import path from "node:path"

export type ExternalResumeFormat = "claude" | "codex"

export type ExternalResumeModel = {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

export type ExternalTextPart = {
  readonly type: "text"
  readonly text: string
}

export type ExternalReasoningPart = {
  readonly type: "reasoning"
  readonly text: string
  /** Provider signatures are retained as provenance, never as replayable v2 state. */
  readonly sourceSignature?: string
}

export type ExternalToolPart = {
  readonly type: "tool"
  readonly id: string
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
  result: {
    readonly text: string
    readonly error: boolean
    readonly status?: string
  }
}

export type ExternalStep = {
  readonly role: "user" | "assistant"
  readonly parts: ReadonlyArray<ExternalTextPart | ExternalReasoningPart | ExternalToolPart>
}

export type ExternalTranscript = {
  readonly format: ExternalResumeFormat
  readonly version: number
  readonly sourceSessionID?: string
  readonly sourceModel?: ExternalResumeModel
  readonly steps: ReadonlyArray<ExternalStep>
}

export type ExternalResumeInput = {
  readonly file: string
  readonly directory: string
  readonly agent: string
  readonly model: ExternalResumeModel
  readonly title?: string
}

export type ExternalResumeRequestOptions = {
  readonly signal?: AbortSignal
  readonly headers?: RequestInit["headers"]
}

export type ExternalResumeClient = {
  readonly location: Pick<OpenCodeClient["location"], "get">
  readonly session: Pick<OpenCodeClient["session"], "import">
}

export class ExternalResumeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExternalResumeError"
  }
}

const CLAUDE_VERSION = 2
const CODEX_VERSION = 0
const EXTERNAL_TRANSCRIPT_MAX_BYTES = 10 * 1024 * 1024
const CLAUDE_METADATA = new Set(["ai-title", "last-prompt", "snapshot", "mode", "permission-mode", "attachment"])
const CODEX_METADATA = new Set(["turn_context", "event_msg", "world_state"])
const INCOMPLETE_TOOL_MESSAGE = "Source transcript ended before this tool returned a result"

type RecordLine = {
  readonly value: Record<string, unknown>
  readonly line: number
}

type ToolCall = {
  readonly id: string
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
  readonly status?: string
  result?: {
    readonly text: string
    readonly error: boolean
    readonly status?: string
  }
}

type AssistantStep = {
  readonly role: "assistant"
  readonly parts: Array<ExternalTextPart | ExternalReasoningPart | ExternalToolPart>
  readonly calls: Map<string, ToolCall>
}

export function parseExternalTranscript(content: string): ExternalTranscript {
  if (!content.trim()) throw new ExternalResumeError("External transcript is empty")

  const records = content.split(/\r?\n/).flatMap((raw, index) => {
    const line = raw.trim()
    if (!line) return []
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new ExternalResumeError(`External transcript line ${index + 1} is not valid JSON`)
    }
    if (!isRecord(value)) throw new ExternalResumeError(`External transcript line ${index + 1} must be a JSON object`)
    return [{ value, line: index + 1 }]
  })
  if (records.length === 0) throw new ExternalResumeError("External transcript contains no JSON records")

  const formats = new Set<ExternalResumeFormat>()
  for (const record of records) {
    if (record.value.type === "session_meta" || record.value.type === "response_item") formats.add("codex")
    if (record.value.type === "user" || record.value.type === "assistant") formats.add("claude")
  }
  if (formats.size !== 1) throw new ExternalResumeError("Unable to detect a single Claude or Codex transcript format")

  const format = formats.values().next().value
  if (format === "claude") return parseClaude(records)
  return parseCodex(records)
}

export async function readExternalTranscript(file: string): Promise<ExternalTranscript> {
  if (!file.trim()) throw new ExternalResumeError("An external transcript file is required")
  if (isExternalPath(file)) throw new ExternalResumeError("External resume accepts local transcript files only")

  const resolved = path.resolve(file)
  const info = await stat(resolved).catch(() => undefined)
  if (!info?.isFile()) throw new ExternalResumeError(`External transcript file not found: ${file}`)

  const handle = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => undefined)
  if (!handle) throw new ExternalResumeError(`Unable to read external transcript file: ${file}`)

  try {
    const initial = await handle.stat()
    if (!initial.isFile()) throw new ExternalResumeError(`External transcript file is not regular: ${file}`)
    if (initial.size > EXTERNAL_TRANSCRIPT_MAX_BYTES) {
      throw new ExternalResumeError(`External transcript file exceeds the 10 MiB limit: ${file}`)
    }

    const bytes = Buffer.alloc(initial.size)
    let offset = 0
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (read.bytesRead === 0) throw new ExternalResumeError(`External transcript file changed while reading: ${file}`)
      offset += read.bytesRead
    }

    const final = await handle.stat()
    if (!final.isFile() || final.size !== initial.size || final.size > EXTERNAL_TRANSCRIPT_MAX_BYTES) {
      throw new ExternalResumeError(`External transcript file changed while reading: ${file}`)
    }
    return parseExternalTranscript(bytes.toString("utf8"))
  } catch (error) {
    if (error instanceof ExternalResumeError) throw error
    throw new ExternalResumeError(`Unable to read external transcript file: ${file}`)
  } finally {
    await handle.close()
  }
}

export function buildExternalTransfer(
  transcript: ExternalTranscript,
  input: {
    readonly projectID: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly agent: string
    readonly model: ExternalResumeModel
    readonly title?: string
  },
): SessionTransferData {
  if (!input.projectID.trim()) throw new ExternalResumeError("The target project ID is required for external resume")
  if (!input.location.directory.trim())
    throw new ExternalResumeError("The target directory is required for external resume")
  if (!input.agent.trim()) throw new ExternalResumeError("An agent is required for external resume")
  validateModel(input.model)
  if (transcript.steps.length === 0) throw new ExternalResumeError("External transcript contains no messages")
  if (transcript.steps[0]?.role !== "user") {
    throw new ExternalResumeError(
      "External transcript starts with an assistant message; the first message must be from a user",
    )
  }
  if (
    !transcript.steps.some(
      (step) => step.role === "user" && step.parts.some((part) => part.type === "text" && part.text.trim()),
    )
  ) {
    throw new ExternalResumeError("External transcript contains no user messages")
  }

  const created = Date.now()
  const model = {
    providerID: input.model.providerID,
    id: input.model.id,
    ...(input.model.variant ? { variant: input.model.variant } : {}),
  }
  const sourceModel = transcript.sourceModel
  const messages = transcript.steps.map((step, index) =>
    toMessage(step, index, created, input.agent, sourceModel ?? model),
  )
  const raw = {
    info: {
      id: Session.ID.create(),
      projectID: input.projectID,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created, updated: created, idle: created },
      location: input.location,
      ...(input.agent ? { agent: input.agent } : {}),
      model,
      ...(input.title ? { title: input.title } : {}),
      metadata: {
        externalResume: {
          format: transcript.format,
          version: transcript.version,
          ...(sourceModel ? { sourceModel } : {}),
          ...(transcript.sourceSessionID ? { sourceSessionID: transcript.sourceSessionID } : {}),
        },
      },
    },
    messages,
  }

  try {
    const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(SessionTransfer.Data))(JSON.stringify(raw))
    return Schema.encodeSync(SessionTransfer.Data)(decoded) as SessionTransferData
  } catch {
    throw new ExternalResumeError("External transcript could not be represented as a v2 session")
  }
}

export async function importExternalTranscript(
  client: ExternalResumeClient,
  input: ExternalResumeInput,
  requestOptions?: ExternalResumeRequestOptions,
) {
  const transcript = await readExternalTranscript(input.file)
  const location = await client.location.get({ location: { directory: input.directory } }, requestOptions)
  const data = buildExternalTransfer(transcript, {
    projectID: location.project.id,
    location: { directory: location.directory, ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}) },
    agent: input.agent,
    model: input.model,
    title: input.title,
  })

  // Import always receives a freshly generated session ID. No source ancestry,
  // revert state, snapshots, or existing target session can be overwritten.
  return client.session.import(
    {
      ...data,
      location: {
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      },
    } as SessionImportInput,
    requestOptions,
  )
}

function parseClaude(records: ReadonlyArray<RecordLine>): ExternalTranscript {
  let version: number | undefined
  let sourceModel: ExternalResumeModel | undefined
  const steps: ExternalStep[] = []
  let pending: AssistantStep | undefined

  for (const record of records) {
    const type = record.value.type
    if (typeof type === "string" && CLAUDE_METADATA.has(type)) continue
    if (type !== "user" && type !== "assistant") {
      throw unsupported(record, "Claude record type", type)
    }

    const recordVersion = readMajor(record.value.version, record, "Claude version")
    if (version === undefined) version = recordVersion
    if (recordVersion !== version)
      throw new ExternalResumeError(`Claude transcript line ${record.line} changes version`)
    if (recordVersion !== CLAUDE_VERSION)
      throw new ExternalResumeError(`Unsupported Claude major version: ${recordVersion}`)
    if (record.value.isSidechain === true) continue

    const message = requireRecord(record.value.message, record, "Claude message")
    const role = requireString(message.role, record, "Claude message role")
    if (role !== type)
      throw new ExternalResumeError(`Claude transcript line ${record.line} has mismatched message role`)
    const content = claudeContent(message.content, record)
    if (role === "assistant" && typeof message.model === "string" && message.model.trim()) {
      const nextModel = { providerID: "anthropic", id: message.model }
      if (sourceModel && (sourceModel.providerID !== nextModel.providerID || sourceModel.id !== nextModel.id)) {
        throw new ExternalResumeError(`Claude transcript line ${record.line} changes source model`)
      }
      sourceModel = nextModel
    }

    if (role === "assistant") {
      const parsed = claudeAssistantParts(content, record)
      if (pending && [...pending.calls.values()].every((call) => call.result !== undefined)) {
        steps.push(finalizeAssistant(pending, record))
        pending = undefined
      }
      if (!pending) pending = { role: "assistant", parts: [], calls: new Map() }
      for (const part of parsed) {
        if (part.type === "tool") {
          if (pending.calls.has(part.id))
            throw new ExternalResumeError(`Claude transcript line ${record.line} repeats tool call ID ${part.id}`)
          pending.calls.set(part.id, {
            id: part.id,
            name: part.name,
            input: part.input,
          })
        }
        pending.parts.push(part)
      }
      continue
    }

    const toolResults = content.filter(
      (block): block is Record<string, unknown> => isRecord(block) && block.type === "tool_result",
    )
    const userBlocks = content.filter((block) => !isRecord(block) || block.type !== "tool_result")
    if (toolResults.length > 0) {
      if (!pending)
        throw new ExternalResumeError(
          `Claude transcript line ${record.line} has tool results without an assistant tool call`,
        )
      for (const result of toolResults) attachClaudeResult(pending, result, record)
      if ([...pending.calls.values()].some((call) => call.result === undefined)) {
        if (userBlocks.length > 0) {
          settleUnpaired(pending)
          steps.push(finalizeAssistant(pending, record))
          pending = undefined
        }
      } else {
        steps.push(finalizeAssistant(pending, record))
        pending = undefined
      }
      if (userBlocks.length > 0) {
        const userParts = claudeUserParts(userBlocks, record)
        steps.push({ role: "user", parts: userParts })
      }
      continue
    }

    if (pending) {
      steps.push(finalizeAssistant(pending, record))
      pending = undefined
    }
    const userParts = claudeUserParts(userBlocks, record)
    steps.push({ role: "user", parts: userParts })
  }

  if (pending) {
    steps.push(finalizeAssistant(pending, records.at(-1) ?? { value: {}, line: 0 }))
  }
  if (version === undefined) throw new ExternalResumeError("No Claude user or assistant records found")
  return { format: "claude", version, sourceModel, steps }
}

function parseCodex(records: ReadonlyArray<RecordLine>): ExternalTranscript {
  let version: number | undefined
  let sourceSessionID: string | undefined
  let sourceProviderID: string | undefined
  let sourceModelID: string | undefined
  const steps: ExternalStep[] = []
  let pending: AssistantStep | undefined

  for (const record of records) {
    const type = record.value.type
    if (type === "session_meta") {
      const payload = requireRecord(record.value.payload, record, "Codex session_meta payload")
      const nextVersion = readCodexMajor(payload.cli_version, record)
      if (version === undefined) version = nextVersion
      if (nextVersion !== version) throw new ExternalResumeError(`Codex transcript line ${record.line} changes version`)
      if (nextVersion !== CODEX_VERSION)
        throw new ExternalResumeError(`Unsupported Codex major version: ${nextVersion}`)
      if (typeof payload.session_id === "string" && payload.session_id.trim()) {
        if (sourceSessionID && sourceSessionID !== payload.session_id) {
          throw new ExternalResumeError(`Codex transcript line ${record.line} changes source session ID`)
        }
        sourceSessionID = payload.session_id
      }
      if (typeof payload.model_provider === "string" && payload.model_provider.trim()) {
        if (sourceProviderID && sourceProviderID !== payload.model_provider) {
          throw new ExternalResumeError(`Codex transcript line ${record.line} changes source model provider`)
        }
        sourceProviderID = payload.model_provider
      }
      continue
    }
    if (typeof type === "string" && CODEX_METADATA.has(type)) {
      const payload = isRecord(record.value.payload) ? record.value.payload : undefined
      if (typeof payload?.model === "string" && payload.model.trim()) {
        if (sourceModelID && sourceModelID !== payload.model) {
          throw new ExternalResumeError(`Codex transcript line ${record.line} changes source model`)
        }
        sourceModelID = payload.model
      }
      continue
    }
    if (type !== "response_item") throw unsupported(record, "Codex record type", type)

    const payload = requireRecord(record.value.payload, record, "Codex response_item payload")
    const itemType = requireString(payload.type, record, "Codex response_item type")
    if (itemType === "message") {
      const role = requireString(payload.role, record, "Codex message role")
      const content = codexContent(payload.content, record)
      if (role === "user") {
        if (pending) {
          steps.push(finalizeAssistant(pending, record))
          pending = undefined
        }
        steps.push({ role: "user", parts: codexTextParts(content, record, "input_text") })
        continue
      }
      if (role !== "assistant") throw unsupported(record, "Codex message role", role)
      const textParts = codexTextParts(content, record, "output_text")
      if (pending && [...pending.calls.values()].every((call) => call.result !== undefined)) {
        steps.push(finalizeAssistant(pending, record))
        pending = undefined
      }
      if (!pending) pending = { role: "assistant", parts: [], calls: new Map() }
      pending.parts.push(...textParts)
      continue
    }
    if (itemType === "function_call" || itemType === "custom_tool_call") {
      if (pending && [...pending.calls.values()].every((call) => call.result !== undefined)) {
        steps.push(finalizeAssistant(pending, record))
        pending = undefined
      }
      if (!pending) pending = { role: "assistant", parts: [], calls: new Map() }
      const id = requireString(payload.call_id, record, "Codex tool call ID")
      const name = requireString(payload.name, record, "Codex tool name")
      if (pending.calls.has(id))
        throw new ExternalResumeError(`Codex transcript line ${record.line} repeats tool call ID ${id}`)
      const input =
        itemType === "function_call"
          ? codexArguments(payload.arguments, record)
          : requireObject(payload.input, record, "Codex tool input")
      const status = optionalString(payload.status, record, "Codex tool call status")
      const call: ToolCall = { id, name, input, ...(status ? { status } : {}) }
      pending.calls.set(id, call)
      pending.parts.push({ type: "tool", id, name, input, result: { text: "", error: false } })
      continue
    }
    if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
      if (!pending)
        throw new ExternalResumeError(`Codex transcript line ${record.line} has tool output without a tool call`)
      const id = requireString(payload.call_id, record, "Codex tool output call ID")
      const call = pending.calls.get(id)
      if (!call)
        throw new ExternalResumeError(`Codex transcript line ${record.line} has output for unknown tool call ${id}`)
      if (call.result !== undefined)
        throw new ExternalResumeError(`Codex transcript line ${record.line} repeats tool output ${id}`)
      const status = optionalString(payload.status, record, "Codex tool output status") ?? call.status
      const output = codexOutput(payload.output, record)
      call.result = { text: output, error: toolResultIsError(status), ...(status ? { status } : {}) }
      const part = pending.parts.find(
        (candidate): candidate is ExternalToolPart => candidate.type === "tool" && candidate.id === id,
      )
      if (!part) throw new ExternalResumeError(`Codex transcript line ${record.line} cannot map tool output ${id}`)
      part.result = call.result
      continue
    }
    if (itemType === "reasoning") {
      const summary = requireArray(payload.summary, record, "Codex reasoning summary")
      const text = summary
        .map((item) => {
          const block = requireRecord(item, record, "Codex reasoning summary block")
          if (block.type !== "summary_text") throw unsupported(record, "Codex reasoning block", block.type)
          return requireString(block.text, record, "Codex reasoning text")
        })
        .join("")
      if (!text) throw unsupported(record, "Codex reasoning block", "encrypted or empty reasoning")
      if (pending && [...pending.calls.values()].every((call) => call.result !== undefined)) {
        steps.push(finalizeAssistant(pending, record))
        pending = undefined
      }
      if (!pending) pending = { role: "assistant", parts: [], calls: new Map() }
      pending.parts.push({ type: "reasoning", text })
      continue
    }
    throw unsupported(record, "Codex response_item type", itemType)
  }

  if (pending) {
    steps.push(finalizeAssistant(pending, records.at(-1) ?? { value: {}, line: 0 }))
  }
  if (version === undefined) throw new ExternalResumeError("Missing Codex session_meta record")
  const sourceModel =
    sourceProviderID && sourceModelID ? { providerID: sourceProviderID, id: sourceModelID } : undefined
  return { format: "codex", version, sourceSessionID, sourceModel, steps }
}

function claudeContent(value: unknown, record: RecordLine): unknown[] {
  if (typeof value === "string") return [{ type: "text", text: value }]
  return requireArray(value, record, "Claude message content")
}

function claudeAssistantParts(content: ReadonlyArray<unknown>, record: RecordLine) {
  return content.map((block) => {
    const value = requireRecord(block, record, "Claude assistant content block")
    if (value.type === "text") return { type: "text", text: requireText(value.text, record, "Claude text") } as const
    if (value.type === "thinking") {
      const signature = optionalString(value.signature, record, "Claude thinking signature")
      return {
        type: "reasoning",
        text: requireText(value.thinking, record, "Claude thinking text"),
        ...(signature ? { sourceSignature: signature } : {}),
      } as const
    }
    if (value.type === "tool_use") {
      return {
        type: "tool",
        id: requireString(value.id, record, "Claude tool call ID"),
        name: requireString(value.name, record, "Claude tool name"),
        input: requireObject(value.input, record, "Claude tool input"),
        result: { text: "", error: false },
      } as const
    }
    throw unsupported(record, "Claude assistant content block", value.type)
  })
}

function claudeUserParts(content: ReadonlyArray<unknown>, record: RecordLine): ExternalTextPart[] {
  const parts = content.map((block) => {
    const value = requireRecord(block, record, "Claude user content block")
    if (value.type !== "text") throw unsupported(record, "Claude user content block", value.type)
    return { type: "text", text: requireText(value.text, record, "Claude user text") } satisfies ExternalTextPart
  })
  if (parts.length === 0)
    throw new ExternalResumeError(`Claude transcript line ${record.line} has an empty user message`)
  return parts
}

function attachClaudeResult(pending: AssistantStep, block: Record<string, unknown>, record: RecordLine) {
  const id = requireString(block.tool_use_id, record, "Claude tool result ID")
  const call = pending.calls.get(id)
  if (!call)
    throw new ExternalResumeError(`Claude transcript line ${record.line} has output for unknown tool call ${id}`)
  if (call.result !== undefined)
    throw new ExternalResumeError(`Claude transcript line ${record.line} repeats tool output ${id}`)
  const output = toolOutput(block.content, record, "Claude tool result content")
  const error = block.is_error === true
  if (block.is_error !== undefined && typeof block.is_error !== "boolean") {
    throw new ExternalResumeError(`Claude transcript line ${record.line} has an invalid tool result error flag`)
  }
  call.result = { text: output, error }
  const part = pending.parts.find(
    (candidate): candidate is ExternalToolPart => candidate.type === "tool" && candidate.id === id,
  )
  if (!part) throw new ExternalResumeError(`Claude transcript line ${record.line} cannot map tool output ${id}`)
  part.result = call.result
}

function toolOutput(value: unknown, record: RecordLine, label: string): string {
  if (typeof value === "string") return value
  if (isRecord(value)) return JSON.stringify(value)
  const blocks = requireArray(value, record, label)
  return blocks
    .map((block) => {
      const item = requireRecord(block, record, `${label} block`)
      if (item.type !== "text") throw unsupported(record, `${label} block`, item.type)
      return requireText(item.text, record, `${label} text`)
    })
    .join("\n")
}

function codexContent(value: unknown, record: RecordLine): unknown[] {
  if (typeof value === "string") return [{ type: "text", text: value }]
  return requireArray(value, record, "Codex message content")
}

function codexTextParts(
  content: ReadonlyArray<unknown>,
  record: RecordLine,
  preferredType: string,
): ExternalTextPart[] {
  const parts = content.map((block) => {
    const value = requireRecord(block, record, "Codex message content block")
    if (value.type !== preferredType && value.type !== "text")
      throw unsupported(record, "Codex message content block", value.type)
    return { type: "text", text: requireText(value.text, record, "Codex message text") } satisfies ExternalTextPart
  })
  if (parts.length === 0) throw new ExternalResumeError(`Codex transcript line ${record.line} has an empty message`)
  return parts
}

function codexArguments(value: unknown, record: RecordLine): Readonly<Record<string, unknown>> {
  if (typeof value === "string") {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new ExternalResumeError(`Codex transcript line ${record.line} has invalid tool arguments JSON`)
    }
    return requireObject(parsed, record, "Codex tool arguments")
  }
  return requireObject(value, record, "Codex tool arguments")
}

function codexOutput(value: unknown, record: RecordLine): string {
  return toolOutput(value, record, "Codex tool output")
}

function finalizeAssistant(pending: AssistantStep, record: RecordLine): ExternalStep {
  settleUnpaired(pending)
  if (pending.parts.length === 0)
    throw new ExternalResumeError(`External transcript line ${record.line} has an empty assistant message`)
  return { role: "assistant", parts: pending.parts }
}

function settleUnpaired(pending: AssistantStep) {
  for (const call of pending.calls.values()) {
    if (call.result !== undefined) continue
    const result = {
      text: INCOMPLETE_TOOL_MESSAGE,
      error: true,
      status: call.status ?? "incomplete",
    }
    call.result = result
    const part = pending.parts.find(
      (candidate): candidate is ExternalToolPart => candidate.type === "tool" && candidate.id === call.id,
    )
    if (part) part.result = result
  }
}

function toMessage(
  step: ExternalStep,
  index: number,
  created: number,
  agent: string,
  sourceModel: ExternalResumeModel,
) {
  const at = created + index
  const id = SessionMessage.ID.create()
  if (step.role === "user") {
    return {
      id,
      type: "user" as const,
      text: step.parts
        .filter((part): part is ExternalTextPart => part.type === "text")
        .map((part) => part.text)
        .join(""),
      time: { created: at },
    }
  }
  const content = step.parts.map((part) => {
    if (part.type === "text") return { type: "text" as const, text: part.text }
    if (part.type === "reasoning") return { type: "reasoning" as const, text: part.text }
    const toolTime = { created: at, ran: at, completed: at }
    return {
      type: "tool" as const,
      id: part.id,
      name: part.name,
      time: toolTime,
      state: part.result.error
        ? {
            status: "error" as const,
            input: part.input,
            error: { type: "external_tool_error", message: part.result.text },
            ...(part.result.text ? { content: [{ type: "text" as const, text: part.result.text }] } : {}),
            ...(part.result.status ? { metadata: { sourceStatus: part.result.status } } : {}),
          }
        : {
            status: "completed" as const,
            input: part.input,
            content: [{ type: "text" as const, text: part.result.text }],
            ...(part.result.status ? { metadata: { sourceStatus: part.result.status } } : {}),
          },
    }
  })
  const reasoningSignatures = step.parts.flatMap((part) =>
    part.type === "reasoning" && part.sourceSignature ? [part.sourceSignature] : [],
  )
  return {
    id,
    type: "assistant" as const,
    agent,
    model: {
      providerID: sourceModel.providerID,
      id: sourceModel.id,
      ...(sourceModel.variant ? { variant: sourceModel.variant } : {}),
    },
    content,
    ...(reasoningSignatures.length > 0 ? { metadata: { externalResume: { reasoningSignatures } } } : {}),
    time: { created: at, streamed: at, completed: at },
    finish: content.some((part) => part.type === "tool") ? ("tool-calls" as const) : ("stop" as const),
  }
}

function toolResultIsError(status: string | undefined) {
  return status !== undefined && status !== "completed" && status !== "success"
}

function validateModel(model: ExternalResumeModel) {
  if (!model.providerID.trim() || !model.id.trim())
    throw new ExternalResumeError("A provider and model are required for external resume")
  if (model.variant !== undefined && !model.variant.trim())
    throw new ExternalResumeError("Model variant cannot be empty")
}

function readMajor(value: unknown, record: RecordLine, label: string) {
  const version = requireString(value, record, label)
  const match = /^(\d+)(?:\.|$)/.exec(version)
  if (!match) throw new ExternalResumeError(`External transcript line ${record.line} has invalid ${label}`)
  return Number(match[1])
}

function readCodexMajor(value: unknown, record: RecordLine) {
  if (isRecord(value)) return readMajor(value.major, record, "Codex CLI version")
  return readMajor(value, record, "Codex CLI version")
}

function requireRecord(value: unknown, record: RecordLine, label: string): Record<string, unknown> {
  if (!isRecord(value))
    throw new ExternalResumeError(`External transcript line ${record.line} requires ${label} to be an object`)
  return value
}

function requireArray(value: unknown, record: RecordLine, label: string): unknown[] {
  if (!Array.isArray(value))
    throw new ExternalResumeError(`External transcript line ${record.line} requires ${label} to be an array`)
  return value
}

function requireObject(value: unknown, record: RecordLine, label: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value))
    throw new ExternalResumeError(`External transcript line ${record.line} requires ${label} to be an object`)
  return value
}

function requireString(value: unknown, record: RecordLine, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new ExternalResumeError(`External transcript line ${record.line} requires ${label}`)
  return value
}

function requireText(value: unknown, record: RecordLine, label: string): string {
  if (typeof value !== "string")
    throw new ExternalResumeError(`External transcript line ${record.line} requires ${label}`)
  return value
}

function optionalString(value: unknown, record: RecordLine, label: string): string | undefined {
  if (value === undefined) return undefined
  return requireString(value, record, label)
}

function unsupported(record: RecordLine, label: string, value: unknown): ExternalResumeError {
  return new ExternalResumeError(`External transcript line ${record.line} has unsupported ${label}: ${String(value)}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isExternalPath(value: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)
}
