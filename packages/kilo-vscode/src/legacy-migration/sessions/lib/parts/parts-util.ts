import type { LegacyApiMessage } from "../legacy-types"

type ToolUse = {
  type?: string
  id?: string
  name?: string
  input?: unknown
}

export function isSimpleText(input: LegacyApiMessage): input is LegacyApiMessage & { content: string } {
  return typeof input.content === "string" && Boolean(input.content)
}

export function isReasoning(input: LegacyApiMessage): input is LegacyApiMessage & { type: "reasoning"; text: string } {
  return input.type === "reasoning" && typeof input.text === "string" && Boolean(input.text)
}

export function isProviderSpecificReasoning(input: LegacyApiMessage) {
  return Boolean(getReasoningText(input))
}

export function getReasoningText(input: LegacyApiMessage) {
  if (typeof input.reasoning_content === "string" && input.reasoning_content.trim()) {
    // Some providers store the model thinking outside normal content blocks, so we need to lift it manually.
    return input.reasoning_content.trim()
  }

  if (!Array.isArray(input.reasoning_details)) return undefined

  const text = input.reasoning_details
    .flatMap((item) => {
      if (!item || typeof item !== "object") return []
      if (typeof (item as { text?: unknown }).text === "string") return [(item as { text: string }).text]
      if (typeof (item as { reasoning?: unknown }).reasoning === "string")
        return [(item as { reasoning: string }).reasoning]
      return []
    })
    .join("\n")
    .trim()

  // reasoning_details can come as provider-specific arrays, so we collapse the readable text we can find.
  return text || undefined
}

export function isSingleTextWithinMessage(input: unknown): input is { type?: string; text: string } {
  return isText(input) && Boolean(input.text)
}

export function isEnvironmentDetails(input: string) {
  return /^\s*<environment_details>[\s\S]*<\/environment_details>\s*$/i.test(input)
}

export function isCompletionResult(
  input: unknown,
): input is { type?: string; name?: string; input: { result: string } } {
  return Boolean(
    input &&
      typeof input === "object" &&
      "type" in input &&
      input.type === "tool_use" &&
      "name" in input &&
      input.name === "attempt_completion" &&
      "input" in input &&
      input.input &&
      typeof input.input === "object" &&
      "result" in input.input &&
      typeof input.input.result === "string" &&
      input.input.result,
  )
}

export function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

export function isToolUse(input: unknown): input is { type?: string; id?: string; name?: string; input?: unknown } {
  return Boolean(input && typeof input === "object" && "type" in input && input.type === "tool_use")
}

export function isText(input: unknown): input is { type?: string; text?: string } {
  return Boolean(input && typeof input === "object" && "type" in input && input.type === "text")
}

export function isToolResult(input: unknown): input is { type?: string; tool_use_id?: string; content?: unknown } {
  return Boolean(input && typeof input === "object" && "type" in input && input.type === "tool_result")
}

// This looks through the blocks inside one legacy message and finds the tool_use whose id
// matches the tool_result we are processing, so we know which tool call produced that result.
export function getToolUse(input: LegacyApiMessage, id: string | undefined) {
  if (!Array.isArray(input.content)) return undefined
  return input.content.find((part) => isToolUse(part) && part.id === id) as ToolUse | undefined
}

export function getText(input: unknown) {
  if (typeof input === "string") return input
  if (!Array.isArray(input)) return undefined
  const text = input
    .flatMap((item) => {
      if (isText(item) && item.text) return [item.text]
      return []
    })
    .join("\n")
    .trim()
  return text || undefined
}

export function cleanLegacyTaskText(input: string) {
  // Legacy sometimes stores the real user prompt wrapped inside <task>...</task>, followed by
  // extra <environment_details>...</environment_details> prompt scaffolding. We only want the
  // actual task text to appear in the migrated conversation, so if a <task> block exists we keep
  // just that inner text and drop the wrapper plus the extra environment block.
  const task = input.match(/<task>([\s\S]*?)<\/task>/i)?.[1]?.trim()
  if (task) return task

  if (isEnvironmentDetails(input)) return ""

  return input
}

export function isLegacySystemErrorText(input: string) {
  return input.trimStart().startsWith("[ERROR]")
}

export function getFeedbackText(input: unknown) {
  const text = getText(input)
  if (!text) return undefined
  const match = text.match(/<feedback>([\s\S]*?)<\/feedback>/i)
  const value = match?.[1]?.trim()
  return value || undefined
}
