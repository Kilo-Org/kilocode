import { describe, expect, it } from "bun:test"
import { state, target } from "../../webview-ui/src/context/todo-revert"
import type { Message, Part, TodoItem } from "../../webview-ui/src/types/messages"

const base = {
  sessionID: "session",
  createdAt: "2026-01-01T00:00:00.000Z",
  time: { created: 1 },
}

const user = (id: string): Message => ({ ...base, id, role: "user" })

const assistant = (id: string, parentID: string): Message => ({ ...base, id, parentID, role: "assistant" })

const todos = (...status: TodoItem["status"][]): TodoItem[] =>
  status.map((status, index) => ({ id: String(index + 1), content: `todo ${index + 1}`, status }))

const part = (id: string, messageID: string, list: TodoItem[]): Part => ({
  id,
  messageID,
  sessionID: "session",
  type: "tool",
  tool: "todowrite",
  state: {
    status: "completed",
    input: { todos: list },
    output: JSON.stringify(list),
    title: `${list.length} todos`,
    metadata: { todos: list },
  },
})

describe("todo revert helpers", () => {
  const messages = [user("message_1"), assistant("message_2", "message_1")]
  const parts = {
    message_2: [
      part("part_1", "message_2", todos("pending", "pending", "pending")),
      part("part_2", "message_2", todos("completed", "pending", "pending")),
      part("part_3", "message_2", todos("completed", "completed", "pending")),
    ],
  }

  it("restores the todo state before a reverted todowrite part", () => {
    expect(state({ messages, parts, revert: { messageID: "message_2", partID: "part_3" } })).toEqual(
      todos("completed", "pending", "pending"),
    )
  })

  it("restores the latest todo state on redo", () => {
    expect(state({ messages, parts })).toEqual(todos("completed", "completed", "pending"))
  })

  it("targets the todowrite part that first completed the clicked todo", () => {
    expect(target({ messages, parts }, 0)?.id).toBe("part_2")
    expect(target({ messages, parts }, 1)?.id).toBe("part_3")
    expect(target({ messages, parts }, 2)).toBeUndefined()
  })

  it("uses normal part ordering inside the revert boundary message", () => {
    expect(state({ messages, parts, revert: { messageID: "message_2", partID: "part_2" } })).toEqual(
      todos("pending", "pending", "pending"),
    )
  })
})
