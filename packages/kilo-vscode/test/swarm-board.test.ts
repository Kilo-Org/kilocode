import { describe, expect, it } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { mergeBoard, usesBoard, type SwarmBoard } from "../webview-ui/src/components/chat/swarm-board"

const message = (id: string, timestamp: number) => ({
  id,
  timestamp,
  from: "main",
  to: "ALL",
  type: "INFO" as const,
  body: id,
})

const board = (input: Partial<SwarmBoard>): SwarmBoard =>
  ({ ownerSessionID: "root", revision: 1, messages: [], hasMore: false, ...input }) as SwarmBoard

describe("mergeBoard", () => {
  it("replaces the board with the newest page", () => {
    const previous = board({ revision: 1, messages: [message("a", 1)] })
    const next = board({ revision: 2, messages: [message("b", 2)] })

    expect(mergeBoard(previous, next)).toBe(next)
  })

  it("puts an older page in front and keeps the revision the user saw", () => {
    const previous = board({ revision: 3, messages: [message("c", 3)], cursor: "c", hasMore: true })
    const older = board({ revision: 4, messages: [message("a", 1), message("b", 2)], cursor: "a", hasMore: true })

    const merged = mergeBoard(previous, older, "c")
    expect(merged.messages.map((item) => item.id)).toEqual(["a", "b", "c"])
    expect(merged.revision).toBe(3)
    expect(merged.hasMore).toBe(true)
  })

  it("stops paging when an older page adds nothing or repeats its cursor", () => {
    const previous = board({ messages: [message("a", 1)], cursor: "a", hasMore: true })

    expect(mergeBoard(previous, board({ messages: [message("a", 1)], cursor: "z", hasMore: true }), "a").hasMore).toBe(
      false,
    )
    expect(mergeBoard(previous, board({ messages: [message("x", 0)], cursor: "a", hasMore: true }), "a").hasMore).toBe(
      false,
    )
  })
})

describe("usesBoard", () => {
  const tool = (name: string) =>
    ({
      type: "assistant",
      id: "m",
      content: [{ type: "tool", id: "t", name, state: { status: "running", input: {}, metadata: {} } }],
    }) as unknown as SessionMessageInfo

  it("finds a board tool call", () => {
    expect(usesBoard([tool("shell"), tool("board_post")])).toBe(true)
    expect(usesBoard([tool("board_read")])).toBe(true)
  })

  it("ignores other tools", () => {
    expect(usesBoard([tool("shell"), tool("subagent")])).toBe(false)
  })

  it("finds a board tool call nested in a Code Mode execute", () => {
    const execute = (toolCalls: unknown) =>
      ({
        type: "assistant",
        id: "m",
        content: [
          {
            type: "tool",
            id: "t",
            name: "execute",
            state: { status: "completed", input: {}, content: [], metadata: { toolCalls } },
          },
        ],
      }) as unknown as SessionMessageInfo

    expect(usesBoard([execute([{ tool: "board_post", status: "completed" }])])).toBe(true)
    expect(usesBoard([execute([{ tool: "board_read", status: "running" }])])).toBe(true)
    expect(usesBoard([execute([{ tool: "shell", status: "completed" }])])).toBe(false)
  })
})
