import { Effect } from "effect"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, SessionID } from "../../src/session/schema"
import { KiloSessionMessageOrder } from "../../src/kilocode/session/message-order"

// Frozen filter from main 0a9faeff69. The shared production scanner must not become its own oracle.
function filterCompacted(msgs: Iterable<MessageV2.WithParts>) {
  const result = [] as MessageV2.WithParts[]
  const completed = new Set<string>()
  let retain: MessageID | undefined
  for (const msg of msgs) {
    result.push(msg)
    if (retain) {
      if (msg.info.id === retain) break
      continue
    }
    if (msg.info.role === "user" && completed.has(msg.info.id)) {
      const part = msg.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
      if (!part) continue
      if (!part.tail_start_id) break
      retain = part.tail_start_id
      if (msg.info.id === retain) break
      continue
    }
    if (msg.info.role === "user" && completed.has(msg.info.id) && msg.parts.some((part) => part.type === "compaction"))
      break
    if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish && !msg.info.error)
      completed.add(msg.info.parentID)
  }
  result.reverse()
  KiloSessionMessageOrder.annotate(result)
  const compactionIndex = result.findLastIndex(
    (msg) => msg.info.role === "user" && msg.parts.some(
      (item): item is MessageV2.CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined,
    ),
  )
  const compaction = result[compactionIndex]
  const part = compaction?.parts.find(
    (item): item is MessageV2.CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined,
  )
  const summaryIndex = compaction ? result.findIndex(
    (msg, index) => index > compactionIndex && msg.info.role === "assistant" && msg.info.summary && msg.info.parentID === compaction.info.id,
  ) : -1
  const tailIndex = part?.tail_start_id ? result.findIndex((msg) => msg.info.id === part.tail_start_id) : -1
  if (tailIndex >= 0 && tailIndex < compactionIndex && summaryIndex > compactionIndex) {
    return [
      ...result.slice(compactionIndex, summaryIndex + 1),
      ...result.slice(tailIndex, compactionIndex),
      ...result.slice(summaryIndex + 1),
    ]
  }
  return result
}

export const fullHistory = Effect.fnUntraced(function* (sessionID: SessionID) {
  return filterCompacted(yield* MessageV2.stream(sessionID))
})
