import type { MessageV2 } from "@/session/message-v2"
import type { MessageID, PartID } from "@/session/schema"

export namespace CheckpointDiff {
  export function snapshots(messages: MessageV2.WithParts[], messageID: MessageID, partID: PartID) {
    const message = messages.find((item) => item.info.id === messageID)
    if (!message || message.info.role !== "assistant") return
    const index = message.parts.findIndex((part) => part.id === partID)
    if (index < 0) return
    const start = message.parts[index]
    if (start?.type !== "step-start" || !start.snapshot) return
    const finish = message.parts
      .slice(index + 1)
      .find((part) => part.type === "step-start" || part.type === "step-finish")
    if (finish?.type !== "step-finish" || !finish.snapshot) return
    return { from: start.snapshot, to: finish.snapshot }
  }
}
