import type { SessionMessageInfo } from "@opencode/client"
import type { KiloBoardRpc } from "@opencode/schema/kilocode/board"

export type SwarmBoard = KiloBoardRpc.Board

const TOOLS: ReadonlySet<string> = new Set(["board_read", "board_post"])

/**
 * Apply one board read. The newest page replaces the board; an older page (`before`) joins in front of the posts
 * already loaded and keeps their revision, because a reset is only valid against the revision the user saw.
 */
export function mergeBoard(previous: SwarmBoard | undefined, next: SwarmBoard, before?: string): SwarmBoard {
  if (!previous || !before) return next
  const known = new Set(previous.messages.map((item) => item.id))
  const added = next.messages.filter((item) => !known.has(item.id))
  return {
    ...next,
    revision: previous.revision,
    hasMore: next.hasMore && added.length > 0 && next.cursor !== before,
    messages: [...added, ...previous.messages],
  }
}

/** True when an agent in the transcript read or posted on the board. */
export function usesBoard(messages: readonly SessionMessageInfo[]): boolean {
  return messages.some(
    (message) => message.type === "assistant" && message.content.some((part) => part.type === "tool" && TOOLS.has(part.name)),
  )
}
