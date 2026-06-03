import type { MessageV2 } from "@/session/message-v2"

const chronology = new WeakMap<MessageV2.WithParts, number>()

export namespace KiloSessionMessageOrder {
  /** Preserve chronological order before model-facing projections rearrange messages. */
  export function annotate(msgs: MessageV2.WithParts[]) {
    for (const [index, msg] of msgs.entries()) chronology.set(msg, index)
    return msgs
  }

  export function compare(a: MessageV2.WithParts, b: MessageV2.WithParts, indexA = -1, indexB = -1) {
    if (a.info.time.created !== b.info.time.created) return a.info.time.created - b.info.time.created
    const sequenceA = chronology.get(a)
    const sequenceB = chronology.get(b)
    if (sequenceA !== undefined && sequenceB !== undefined && sequenceA !== sequenceB) return sequenceA - sequenceB
    return indexA - indexB
  }

  /** Derive active messages by chronology while keeping queued tasks in model-facing projection order. */
  export function latest(msgs: MessageV2.WithParts[]) {
    let user: MessageV2.WithParts | undefined
    let assistant: MessageV2.WithParts | undefined
    let finished: MessageV2.WithParts | undefined
    let userIndex = -1
    let assistantIndex = -1
    let finishedIndex = -1

    for (const [index, msg] of msgs.entries()) {
      const info = msg.info
      if (info.role === "user" && (!user || compare(msg, user, index, userIndex) > 0)) {
        user = msg
        userIndex = index
      }
      if (info.role === "assistant" && (!assistant || compare(msg, assistant, index, assistantIndex) > 0)) {
        assistant = msg
        assistantIndex = index
      }
      if (info.role === "assistant" && info.finish && (!finished || compare(msg, finished, index, finishedIndex) > 0)) {
        finished = msg
        finishedIndex = index
      }
    }

    const pivot = msgs.findLastIndex((msg) => msg.info.role === "assistant" && msg.info.finish)
    const tasks = msgs
      .slice(pivot + 1)
      .reverse()
      .flatMap((msg) =>
        msg.parts.filter(
          (part): part is MessageV2.CompactionPart | MessageV2.SubtaskPart =>
            part.type === "compaction" || part.type === "subtask",
        ),
      )

    return {
      user: user?.info.role === "user" ? user.info : undefined,
      assistant: assistant?.info.role === "assistant" ? assistant.info : undefined,
      finished: finished?.info.role === "assistant" ? finished.info : undefined,
      userMessage: user,
      assistantMessage: assistant,
      finishedMessage: finished,
      tasks,
    }
  }
}
