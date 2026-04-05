import type { KilocodeSessionImportMessageData as Message } from "@kilocode/sdk/v2"
import type { LegacyApiMessage, LegacyHistoryItem } from "./legacy-types"
import { createMessageID, createSessionID } from "./ids"

type Body = NonNullable<Message["body"]>
type Data = Body["data"]
type User = Extract<Data, { role: "user" }>
type Assistant = Extract<Data, { role: "assistant" }>

export function parseMessagesFromConversation(
  conversation: LegacyApiMessage[],
  id: string,
  dirOrItem?: string | LegacyHistoryItem,
  item?: LegacyHistoryItem,
): Array<NonNullable<Message["body"]>> {
  const dir = typeof dirOrItem === "string" ? dirOrItem : (dirOrItem?.workspace ?? "")
  const next = typeof dirOrItem === "string" ? item : dirOrItem

  return conversation
    .filter((entry) => entry.role === "user" || entry.role === "assistant")
    .map((entry, index) => parseMessage(entry, index, id, dir, next))
    .filter((message): message is NonNullable<Message["body"]> => Boolean(message))
}

function parseMessage(
  entry: LegacyApiMessage,
  index: number,
  id: string,
  dir: string,
  item?: LegacyHistoryItem,
): NonNullable<Message["body"]> | undefined {
  const created = entry.ts ?? item?.ts ?? 0

  if (entry.role === "user") {
    const data: User = {
      role: "user",
      time: { created },
      agent: "user",
      model: {
        providerID: "legacy",
        modelID: "legacy",
      },
    }

    return {
      id: createMessageID(id, index),
      sessionID: createSessionID(id),
      timeCreated: created,
      data,
    }
  }

  if (entry.role === "assistant") {
    const data: Assistant = {
      role: "assistant",
      time: { created, completed: created },
      parentID: index > 0 ? createMessageID(id, index - 1) : createMessageID(id, index),
      modelID: "legacy",
      providerID: "legacy",
      mode: item?.mode ?? "code",
      agent: "main",
      path: {
        cwd: dir,
        root: dir,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    }

    return {
      id: createMessageID(id, index),
      sessionID: createSessionID(id),
      timeCreated: created,
      data,
    }
  }

  return undefined
}
