import type { KilocodeSessionImportPartData as Part } from "@kilocode/sdk/v2"
import type { LegacyApiMessage, LegacyHistoryItem } from "../legacy-types"
import { createExtraPartID, createMessageID, createPartID, createSessionID } from "../ids"
import { toReasoning, toText, toTool } from "./parts-builder"
import {
  getFeedbackText,
  isCompletionResult,
  isEnvironmentDetails,
  getReasoningText,
  isProviderSpecificReasoning,
  isReasoning,
  isSimpleText,
  isSingleTextWithinMessage,
  isToolResult,
  isToolUse,
} from "./parts-util"
import { mergeToolUseAndResult, thereIsNoToolResult } from "./merge-tools"

export function parsePartsFromConversation(
  conversation: LegacyApiMessage[],
  id: string,
  item?: LegacyHistoryItem,
): Array<NonNullable<Part["body"]>> {
  const list = conversation.filter((entry) => entry.role === "user" || entry.role === "assistant")
  return list.flatMap((entry, index) => parseParts(entry, index, id, list, item))
}

function parseParts(
  entry: LegacyApiMessage,
  index: number,
  id: string,
  conversation: LegacyApiMessage[],
  item?: LegacyHistoryItem,
): Array<NonNullable<Part["body"]>> {
  const messageID = createMessageID(id, index)
  const sessionID = createSessionID(id)
  const created = entry.ts ?? item?.ts ?? 0

  if (isSimpleText(entry)) {
    // Ignore raw <environment_details> blocks because they are legacy prompt scaffolding,
    // not actual user-visible conversation content we want to preserve in the migrated session.
    if (isEnvironmentDetails(entry.content)) return []
    return [toText(createPartID(id, index, 0), messageID, sessionID, created, entry.content)]
  }

  if (!Array.isArray(entry.content)) return []

  const parts: Array<NonNullable<Part["body"]>> = []

  if (isReasoning(entry)) {
    parts.push(toReasoning(createExtraPartID(id, index, "reasoning"), messageID, sessionID, created, entry.text))
  }

  // Some providers store thinking outside normal content blocks, so this handles those provider-specific fields.
  if (!isReasoning(entry) && isProviderSpecificReasoning(entry)) {
    const reasoning = getReasoningText(entry)
    if (reasoning) {
      parts.push(
        toReasoning(createExtraPartID(id, index, "provider-reasoning"), messageID, sessionID, created, reasoning),
      )
    }
  }

  entry.content.forEach((part, partIndex) => {
    const partID = createPartID(id, index, partIndex)

    // Legacy can store a message as several pieces; this handles one text block inside that larger message.
    if (isSingleTextWithinMessage(part)) {
      // Ignore standalone <environment_details> text blocks for the same reason: they describe
      // editor/runtime context for the old prompt, but they are not meaningful chat content.
      if (isEnvironmentDetails(part.text)) return
      parts.push(toText(partID, messageID, sessionID, created, part.text))
      return
    }

    // The legacy session can contain a final completion message after an assistant interaction.
    // Treat it like a regular assistant text part so the migrated session keeps that final visible answer.
    if (isCompletionResult(part)) {
      const text = part.input.result
      parts.push(toText(partID, messageID, sessionID, created, text))
      return
    }

    if (isToolUse(part) && thereIsNoToolResult(conversation, part.id)) {
      parts.push(toTool(partID, messageID, sessionID, created, part))
      return
    }

    if (isToolResult(part)) {
      const feedback = getFeedbackText(part.content)
      if (feedback) {
        parts.push(
          toText(createExtraPartID(id, index, `feedback-${partIndex}`), messageID, sessionID, created, feedback),
        )
      }

      // tool_result usually lives in the following user message, while the matching tool_use lives
      // in the earlier assistant message, so we need the whole conversation to reconcile both halves.
      const tool = mergeToolUseAndResult(partID, messageID, sessionID, created, conversation, part)
      if (!tool) return
      parts.push(tool)
      return
    }
  })

  return parts
}
