import { AsyncQueue } from "@/util/queue"
import type { StreamTextResult, ToolSet } from "ai"

type Full = StreamTextResult<ToolSet, unknown>["fullStream"] extends AsyncIterable<infer Item> ? Item : never
type Output = Pick<StreamTextResult<ToolSet, unknown>, "fullStream" | "textStream" | "text">

const END = Symbol("done")
type Item<T> = T | typeof END

// ── Agent SDK message types ────────────────────────────────────────

interface SDKContentText {
  type: "text"
  text: string
}

interface SDKContentThinking {
  type: "thinking"
  thinking: string
}

interface SDKContentToolUse {
  type: "tool_use"
  id: string
  name: string
  input: unknown
}

type SDKContentBlock = SDKContentText | SDKContentThinking | SDKContentToolUse

interface SDKAssistantMessage {
  type: "assistant"
  uuid?: string
  session_id?: string
  message: {
    content: SDKContentBlock[]
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    stop_reason?: string
  }
  parent_tool_use_id?: string
}

interface SDKToolResultContent {
  type: "tool_result"
  tool_use_id: string
  content?: unknown
}

interface SDKUserMessage {
  type: "user"
  isSynthetic?: boolean
  message: {
    content: SDKToolResultContent[]
  }
}

interface SDKResultMessage {
  type: "result"
  subtype: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  total_cost_usd?: number
  result?: string
  errors?: string[]
}

type SDKMessage = SDKAssistantMessage | SDKUserMessage | SDKResultMessage | { type: string }

// ── Helpers ────────────────────────────────────────────────────────

function done(): typeof END {
  return END
}

function toQueue<T>(src: AsyncQueue<Item<T>>) {
  return new ReadableStream<T>({
    async pull(controller) {
      const item = await src.next()
      if (item === END) {
        controller.close()
        return
      }
      controller.enqueue(item)
    },
  }) as ReadableStream<T> & AsyncIterable<T>
}

function pushText(full: AsyncQueue<Item<Full>>, plain: AsyncQueue<Item<string>>, body: string) {
  if (!body) return
  full.push({ type: "text-start" } as Full)
  full.push({ type: "text-delta", text: body } as Full)
  full.push({ type: "text-end" } as Full)
  plain.push(body)
}

function pushThinking(full: AsyncQueue<Item<Full>>, body: string, id: string) {
  if (!body) return
  full.push({ type: "reasoning-start", id } as Full)
  full.push({ type: "reasoning-delta", id, text: body } as Full)
  full.push({ type: "reasoning-end", id } as Full)
}

function pushToolUse(full: AsyncQueue<Item<Full>>, block: SDKContentToolUse) {
  full.push({
    type: "tool-input-start",
    id: block.id,
    toolName: block.name,
  } as Full)
  full.push({
    type: "tool-input-end",
    id: block.id,
  } as Full)
  full.push({
    type: "tool-call",
    toolCallId: block.id,
    toolName: block.name,
    input: typeof block.input === "object" && block.input !== null ? block.input : {},
  } as Full)
}

function pushToolResult(full: AsyncQueue<Item<Full>>, toolUseId: string, content: unknown, toolName: string) {
  full.push({
    type: "tool-result",
    toolCallId: toolUseId,
    toolName,
    input: undefined,
    output: {
      output: content,
    },
  } as Full)
}

function extractUsage(raw?: {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}) {
  const inputTokens = raw?.input_tokens ?? 0
  const outputTokens = raw?.output_tokens ?? 0
  const cacheRead = raw?.cache_read_input_tokens ?? 0
  const cacheWrite = raw?.cache_creation_input_tokens ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens + cacheRead + cacheWrite,
    reasoningTokens: 0,
    cachedInputTokens: cacheRead,
  }
}

function errorMessage(msg?: SDKResultMessage) {
  const first = msg?.errors?.find((item) => typeof item === "string" && item.length > 0)
  if (first) return first
  if (msg?.subtype && msg.subtype !== "success") return `Agent SDK failed: ${msg.subtype}`
  return "Agent SDK failed"
}

// ── Bridge ─────────────────────────────────────────────────────────

/**
 * Converts an async iterable of Agent SDK messages into a Vercel AI SDK
 * StreamTextResult-compatible output with fullStream, textStream, and text.
 */
export function bridgeMessages(messages: AsyncIterable<unknown>): Output {
  const full = new AsyncQueue<Item<Full>>()
  const plain = new AsyncQueue<Item<string>>()

  let accumulatedText = ""
  let resolveText = (_value: string) => {}
  let rejectText = (_error: unknown) => {}

  const textPromise = new Promise<string>((ok, fail) => {
    resolveText = ok
    rejectText = fail
  })

  // Map tool_use IDs to tool names so we can label tool-result events
  const pendingTools = new Map<string, string>()

  const close = () => {
    full.push(done())
    plain.push(done())
  }

  const fail = (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err))
    full.push({ type: "error", error } as Full)
    close()
    rejectText(error)
  }

  const stop = (msg?: SDKResultMessage) => {
    full.push({
      type: "finish-step",
      finishReason: "stop",
      usage: extractUsage(msg?.usage),
    } as Full)
    close()
    resolveText(accumulatedText.trim())
  }

  void (async () => {
    full.push({ type: "start" } as Full)
    full.push({ type: "start-step" } as Full)

    try {
      for await (const raw of messages) {
        const msg = raw as SDKMessage
        if (!msg || typeof msg !== "object" || typeof msg.type !== "string") continue

        switch (msg.type) {
          case "assistant": {
            const assistant = msg as SDKAssistantMessage
            const content = assistant.message?.content
            if (!Array.isArray(content)) break

            for (const block of content) {
              switch (block.type) {
                case "text": {
                  const body = (block as SDKContentText).text
                  if (body) {
                    accumulatedText += `${accumulatedText ? "\n" : ""}${body}`
                    pushText(full, plain, body)
                  }
                  break
                }
                case "thinking": {
                  const body = (block as SDKContentThinking).thinking
                  const id = assistant.uuid ?? "thinking"
                  pushThinking(full, body, id)
                  break
                }
                case "tool_use": {
                  const toolBlock = block as SDKContentToolUse
                  pendingTools.set(toolBlock.id, toolBlock.name)
                  pushToolUse(full, toolBlock)
                  break
                }
              }
            }
            break
          }

          case "user": {
            const user = msg as SDKUserMessage
            if (!user.isSynthetic) break
            const content = user.message?.content
            if (!Array.isArray(content)) break

            for (const block of content) {
              if (block.type !== "tool_result") continue
              const toolResult = block as SDKToolResultContent
              const toolName = pendingTools.get(toolResult.tool_use_id) ?? "unknown"
              pushToolResult(full, toolResult.tool_use_id, toolResult.content, toolName)
              pendingTools.delete(toolResult.tool_use_id)
            }
            break
          }

          case "result": {
            const result = msg as SDKResultMessage
            if (result.subtype !== "success") {
              fail(new Error(errorMessage(result)))
              return
            }
            stop(result)
            return
          }

          default:
            // Ignore system, status, and other message types
            break
        }
      }

      // If the iterable ended without a result message, close gracefully
      stop()
    } catch (err) {
      fail(err)
    }
  })()

  return {
    fullStream: toQueue(full),
    textStream: toQueue(plain),
    text: textPromise,
  }
}
