// A LanguageModelV3 backed by the Claude Code CLI.
//
// The AI SDK contract is stateless: `doStream` emits tool calls, the caller
// executes them, and a *new* `doStream` arrives carrying the results. The CLI
// is the opposite — it keeps one process alive and blocks inside an MCP request
// until the tool answers. The bridge reconciles the two: a tool call is parked
// on the MCP side, surfaced as an AI SDK `tool-call`, and resolved when the
// next `doStream` shows up with the matching tool result. Sessions are matched
// by parked tool-call id, which is exact and needs no prompt hashing.
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider"
import type { BridgeCall, ToolSpec } from "./bridge"
import { TOOL_PREFIX } from "./bridge"
import * as Session from "./session"
import type { ContentBlock } from "./session"

/** Sessions idle this long are reaped; a turn never pauses for this long. */
const IDLE_MS = 10 * 60_000

export type Config = {
  provider: string
  bin: string
  cwd?: string
  env?: Record<string, string>
}

type Entry = {
  session: Session.Session
  tools: ToolSpec[]
  timer?: ReturnType<typeof setTimeout>
}

const sessions = new Map<string, Entry>()

function reap(id: string): void {
  const entry = sessions.get(id)
  if (!entry) return
  sessions.delete(id)
  if (entry.timer) clearTimeout(entry.timer)
  void entry.session.close()
}

function touch(id: string): void {
  const entry = sessions.get(id)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => reap(id), IDLE_MS)
  entry.timer.unref?.()
}

function text(output: LanguageModelV3ToolResultOutput): { text: string; isError: boolean } {
  if (output.type === "text" || output.type === "error-text")
    return { text: output.value, isError: output.type === "error-text" }
  if (output.type === "json" || output.type === "error-json")
    return { text: JSON.stringify(output.value), isError: output.type === "error-json" }
  if (output.type === "content") {
    const joined = output.value.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n")
    return { text: joined, isError: false }
  }
  return { text: JSON.stringify(output), isError: false }
}

function toBase64(data: string | Uint8Array): string {
  if (typeof data === "string") {
    // AI SDK file parts occasionally arrive as a data URL rather than bare
    // base64; strip the prefix if present.
    const match = /^data:[^;]+;base64,(.*)$/s.exec(data)
    return match ? match[1] : data
  }
  return Buffer.from(data).toString("base64")
}

function imageBlock(mediaType: string, data: string | Uint8Array | URL): ContentBlock {
  if (data instanceof URL) return { type: "image", source: { type: "url", url: data.toString() } }
  return { type: "image", source: { type: "base64", media_type: mediaType, data: toBase64(data) } }
}

/** Image attachments across all user turns, as real Claude image blocks. */
function images(prompt: LanguageModelV3Prompt): ContentBlock[] {
  const out: ContentBlock[] = []
  for (const message of prompt) {
    if (message.role !== "user") continue
    for (const part of message.content) {
      if (part.type !== "file" || !part.mediaType.startsWith("image/")) continue
      out.push(imageBlock(part.mediaType, part.data))
    }
  }
  return out
}

/** Tool results carried by the tail of an incoming prompt. */
function results(prompt: LanguageModelV3Prompt): Array<{ id: string; text: string; isError: boolean }> {
  const out: Array<{ id: string; text: string; isError: boolean }> = []
  for (const message of prompt) {
    if (message.role !== "tool") continue
    for (const part of message.content) {
      if (part.type !== "tool-result") continue
      out.push({ id: part.toolCallId, ...text(part.output) })
    }
  }
  return out
}

function specs(tools: LanguageModelV3CallOptions["tools"]): ToolSpec[] {
  if (!tools) return []
  const out: ToolSpec[] = []
  for (const tool of tools) {
    // Provider-defined tools have no schema we can forward over MCP.
    if (tool.type !== "function") continue
    out.push({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    })
  }
  return out
}

function render(prompt: LanguageModelV3Prompt): { system: string; user: string } {
  const system: string[] = []
  const lines: string[] = []
  for (const message of prompt) {
    if (message.role === "system") {
      system.push(message.content)
      continue
    }
    if (message.role === "user") {
      const body = message.content
        .map((part) => {
          if (part.type === "text") return part.text
          if (part.type === "file" && part.mediaType.startsWith("image/")) return "[image attached]"
          return `[${part.type} omitted]`
        })
        .join("\n")
      lines.push(lines.length ? `\n<user>\n${body}\n</user>` : body)
      continue
    }
    if (message.role === "assistant") {
      const body = message.content
        .map((part) => {
          if (part.type === "text") return part.text
          if (part.type === "tool-call") return `[called ${part.toolName}: ${JSON.stringify(part.input)}]`
          return ""
        })
        .filter(Boolean)
        .join("\n")
      if (body) lines.push(`\n<assistant>\n${body}\n</assistant>`)
      continue
    }
    if (message.role === "tool") {
      const body = message.content
        .filter((part) => part.type === "tool-result")
        .map((part) => `[${part.toolName} result] ${text(part.output).text}`)
        .join("\n")
      if (body) lines.push(`\n<tool_results>\n${body}\n</tool_results>`)
    }
  }
  return { system: system.join("\n\n"), user: lines.join("\n") }
}

function finish(reason: LanguageModelV3FinishReason["unified"]): LanguageModelV3FinishReason {
  return { unified: reason, raw: undefined }
}

function usage(input: { input: number; output: number; cacheRead: number; cacheWrite: number }): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: input.input + input.cacheRead + input.cacheWrite,
      noCache: input.input,
      cacheRead: input.cacheRead,
      cacheWrite: input.cacheWrite,
    },
    outputTokens: { total: input.output, text: undefined, reasoning: undefined },
    raw: undefined,
  }
}

export class ClaudeCodeLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3"

  constructor(
    readonly modelId: string,
    private readonly config: Config,
  ) {}

  get provider(): string {
    return this.config.provider
  }

  get supportedUrls(): Record<string, RegExp[]> {
    return {}
  }

  /** Find the live session waiting on any of these tool results. */
  private resume(prompt: LanguageModelV3Prompt) {
    const pending = results(prompt)
    if (!pending.length) return undefined
    for (const [id, entry] of sessions) {
      if (!entry.session.alive) {
        reap(id)
        continue
      }
      const parked = new Set(entry.session.pending().map((call: BridgeCall) => call.id))
      const matched = pending.filter((item) => parked.has(item.id))
      if (matched.length) return { id, entry, matched }
    }
    return undefined
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV3StreamPart>
  }> {
    const warnings: SharedV3Warning[] = []
    // The CLI exposes no knobs for these; surface that rather than silently
    // ignoring a caller's sampling configuration.
    for (const key of ["temperature", "topP", "topK", "frequencyPenalty", "presencePenalty", "seed"] as const) {
      if (options[key] !== undefined)
        warnings.push({ type: "unsupported", feature: key, details: "Claude Code CLI controls sampling." })
    }

    const tools = specs(options.tools)
    const resumed = this.resume(options.prompt)

    const entry: Entry = await (async () => {
      if (resumed) {
        resumed.entry.tools = tools
        return resumed.entry
      }
      const rendered = render(options.prompt)
      // The CLI's --effort flag is fixed at process spawn time, so a variant
      // change only takes effect on the next new session, same as the system
      // prompt above.
      const effort = (options.providerOptions?.["claude-code"] as { effort?: string } | undefined)?.effort
      const created: Entry = {
        session: await Session.start({
          bin: this.config.bin,
          model: this.modelId,
          system: rendered.system || undefined,
          effort,
          cwd: this.config.cwd,
          env: this.config.env,
          tools: () => created.tools,
        }),
        tools,
      }
      sessions.set(created.session.id, created)
      const attachments = images(options.prompt)
      const content: ContentBlock[] = rendered.user ? [{ type: "text", text: rendered.user }] : []
      content.push(...attachments)
      created.session.send(content.length ? content : [{ type: "text", text: "" }])
      return created
    })()

    const id = entry.session.id
    touch(id)
    if (resumed) for (const item of resumed.matched) entry.session.settle(item.id, item.text, item.isError)

    const abort = () => reap(id)
    options.abortSignal?.addEventListener("abort", abort, { once: true })

    const iterator = entry.session.stream

    return {
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings })
          const blockID = `cc_${Date.now().toString(36)}`
          let openText = false
          let openReasoning = false
          let expected = 0
          const batch: BridgeCall[] = []
          let totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
          let reason: LanguageModelV3FinishReason["unified"] = "stop"
          let failure: string | undefined

          const closeBlocks = () => {
            if (openReasoning) controller.enqueue({ type: "reasoning-end", id: `${blockID}_r` })
            if (openText) controller.enqueue({ type: "text-end", id: blockID })
            openReasoning = false
            openText = false
          }

          try {
            // Manual iteration (not `for await`): breaking out of a `for await`
            // would call .return() and permanently close the session generator,
            // which must survive across doStream calls.
            while (true) {
              const next = await iterator.next()
              if (next.done) break
              const event = next.value
              if (event.type === "text") {
                if (openReasoning) {
                  controller.enqueue({ type: "reasoning-end", id: `${blockID}_r` })
                  openReasoning = false
                }
                if (!openText) {
                  controller.enqueue({ type: "text-start", id: blockID })
                  openText = true
                }
                controller.enqueue({ type: "text-delta", id: blockID, delta: event.text })
                continue
              }
              if (event.type === "reasoning") {
                if (!openReasoning) {
                  controller.enqueue({ type: "reasoning-start", id: `${blockID}_r` })
                  openReasoning = true
                }
                controller.enqueue({ type: "reasoning-delta", id: `${blockID}_r`, delta: event.text })
                continue
              }
              if (event.type === "step") {
                expected = event.tools
                continue
              }
              if (event.type === "tool") {
                batch.push(event.call)
                if (expected > 0 && batch.length >= expected) break
                continue
              }
              if (event.type === "usage") {
                totals = {
                  input: event.input,
                  output: event.output,
                  cacheRead: event.cacheRead,
                  cacheWrite: event.cacheWrite,
                }
                continue
              }
              if (event.type === "done") {
                reason = event.reason === "error" ? "error" : event.reason
                failure = event.message
                break
              }
            }
          } catch (error) {
            failure = error instanceof Error ? error.message : String(error)
            reason = "error"
          }

          closeBlocks()

          if (batch.length) {
            for (const call of batch) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: call.id,
                // Claude Code namespaces MCP tools as mcp__<server>__<tool>;
                // Kilo only knows the bare name.
                toolName: call.name.startsWith(TOOL_PREFIX) ? call.name.slice(TOOL_PREFIX.length) : call.name,
                // V3 carries tool arguments as a JSON string, not an object.
                input: JSON.stringify(call.args ?? {}),
              })
            }
            controller.enqueue({ type: "finish", finishReason: finish("tool-calls"), usage: usage(totals) })
            controller.close()
            return
          }

          if (reason === "error") {
            controller.enqueue({ type: "error", error: new Error(failure ?? "Claude Code session failed") })
            reap(id)
          } else {
            // Turn complete: the CLI process has nothing left to do.
            reap(id)
          }
          controller.enqueue({ type: "finish", finishReason: finish(reason), usage: usage(totals) })
          controller.close()
        },
        cancel() {
          reap(id)
        },
      }),
    }
  }

  async doGenerate(options: LanguageModelV3CallOptions) {
    const { stream } = await this.doStream(options)
    const content: any[] = []
    let reason: LanguageModelV3FinishReason = finish("stop")
    let totals: any = usage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    const warnings: SharedV3Warning[] = []
    let buffer = ""
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === "stream-start") warnings.push(...value.warnings)
      if (value.type === "text-delta") buffer += value.delta
      if (value.type === "tool-call")
        content.push({ type: "tool-call", toolCallId: value.toolCallId, toolName: value.toolName, input: value.input })
      if (value.type === "finish") {
        reason = value.finishReason
        totals = value.usage
      }
      if (value.type === "error") throw value.error
    }
    if (buffer) content.unshift({ type: "text", text: buffer })
    return { content, finishReason: reason, usage: totals, warnings }
  }
}
