import type { KilocodeSessionImportPartData as Part } from "@kilocode/sdk/v2"
import type { LegacyApiMessage } from "../legacy-types"
import { getText, getToolUse, isToolResult, record } from "./parts-util"

type Body = NonNullable<Part["body"]>
type Data = Body["data"]
type Tool = Extract<Data, { type: "tool" }>
type ToolCompleted = Extract<Tool["state"], { status: "completed" }>

// This takes the "tool started" half and the matching "tool finished" half,
// and merges both so the migrated session keeps one complete tool action.
export function mergeToolUseAndResult(
  partID: string,
  messageID: string,
  sessionID: string,
  created: number,
  conversation: LegacyApiMessage[],
  result: { type?: string; tool_use_id?: string; content?: unknown },
): NonNullable<Part["body"]> | undefined {
  const tool = getToolUseFromConversation(conversation, result.tool_use_id)
  if (!tool) return undefined
  const callID = typeof tool.id === "string" ? tool.id : partID
  const name = typeof tool.name === "string" ? tool.name : "unknown"
  const output = getText(result.content) ?? name
  const state: ToolCompleted = {
    status: "completed",
    input: record(tool.input),
    output,
    title: name,
    metadata: {},
    time: {
      start: created,
      end: created,
    },
  }

  const data: Tool = {
    type: "tool",
    callID,
    tool: name,
    state,
  }

  return {
    id: partID,
    messageID,
    sessionID,
    timeCreated: created,
    data,
  }
}

export function thereIsNoToolResult(conversation: LegacyApiMessage[], id: string | undefined) {
  return !conversation.some(
    (entry) =>
      Array.isArray(entry.content) && entry.content.some((part) => isToolResult(part) && part.tool_use_id === id),
  )
}

function getToolUseFromConversation(conversation: LegacyApiMessage[], id: string | undefined) {
  for (const entry of conversation) {
    const tool = getToolUse(entry, id)
    if (tool) return tool
  }
  return undefined
}
