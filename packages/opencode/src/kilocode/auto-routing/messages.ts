import { asSchema, type ModelMessage, type Tool } from "ai"
import { isRecord } from "@/util/record"

// ADR 0005: the routing worker classifies the request exactly as the gateway
// does, so client decisions and gateway decisions share one normalization. The
// worker receives OpenAI-format messages and tools, built here from the
// AI SDK message list the session already assembled.
export function openaiMessages(messages: ReadonlyArray<ModelMessage>): unknown[] {
  const out: unknown[] = []
  for (const message of messages) {
    if (message.role === "system") {
      out.push({ role: "system", content: text(message.content) })
      continue
    }
    if (message.role === "user") {
      out.push({ role: "user", content: userContent(message.content) })
      continue
    }
    if (message.role === "assistant") {
      out.push(assistantContent(message.content))
      continue
    }
    for (const part of message.content) {
      if (part.type !== "tool-result") continue
      out.push({
        role: "tool",
        tool_call_id: part.toolCallId,
        content: toolResult(part.output),
      })
    }
  }
  return out
}

export async function openaiTools(tools: Record<string, Tool>): Promise<unknown[]> {
  return Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      type: "function",
      function: {
        name,
        description: tool.description ?? "",
        parameters: await asSchema(tool.inputSchema).jsonSchema,
      },
    })),
  )
}

function text(content: unknown): string {
  if (typeof content === "string") return content
  return typeof content === "undefined" ? "" : JSON.stringify(content)
}

function userContent(content: unknown): string | unknown[] {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return text(content)
  const parts: unknown[] = []
  for (const part of content) {
    if (!isRecord(part)) continue
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ type: "text", text: part.text })
      continue
    }
    if (part.type === "image") {
      const url = imageUrl(part.image)
      if (url) parts.push({ type: "image_url", image_url: { url } })
    }
  }
  return parts.length > 0 ? parts : ""
}

function imageUrl(image: unknown): string | undefined {
  if (typeof image === "string") return image
  if (image instanceof URL) return image.toString()
  return undefined
}

function assistantContent(content: unknown): unknown {
  if (typeof content === "string") return { role: "assistant", content }
  if (!Array.isArray(content)) return { role: "assistant", content: text(content) }
  const textParts: string[] = []
  const calls: unknown[] = []
  for (const part of content) {
    if (!isRecord(part)) continue
    if (part.type === "text" && typeof part.text === "string") {
      textParts.push(part.text)
      continue
    }
    if (part.type === "tool-call") {
      calls.push({
        id: part.toolCallId,
        type: "function",
        function: { name: part.toolName, arguments: JSON.stringify(part.input ?? {}) },
      })
    }
  }
  return {
    role: "assistant",
    content: textParts.join("\n"),
    ...(calls.length > 0 ? { tool_calls: calls } : {}),
  }
}

function toolResult(output: unknown): string {
  if (!isRecord(output)) return text(output)
  if (output.type === "text" || output.type === "error-text") {
    return typeof output.value === "string" ? output.value : text(output.value)
  }
  if (output.type === "json" || output.type === "error-json") return JSON.stringify(output.value)
  return JSON.stringify(output.value ?? output)
}
