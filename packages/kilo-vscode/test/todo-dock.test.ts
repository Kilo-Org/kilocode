import { describe, expect, it } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import {
  TODO_TITLE_MAX,
  todoFinished,
  todoFit,
  todoStats,
  todoVisible,
  type TodoItem,
} from "../webview-ui/src/components/chat/todo/todo-dock"
import { hasTodoWrite, todoState } from "../webview-ui/src/v2/todo-state"

// Same shape as the backend sends: no ID, the text is the identity.
const item = (name: string, status: TodoItem["status"]): TodoItem => ({ content: `Item ${name}`, status })

describe("todoStats", () => {
  it("leaves cancelled items out of the total", () => {
    const stats = todoStats([item("1", "completed"), item("2", "cancelled"), item("3", "pending")])
    expect(stats.done).toBe(1)
    expect(stats.total).toBe(2)
    expect(stats.all).toBe(false)
    expect(stats.active?.content).toBe("Item 3")
  })

  it("prefers the item in progress over the next pending one", () => {
    expect(todoStats([item("1", "pending"), item("2", "in_progress")]).active?.content).toBe("Item 2")
  })

  it("treats a list of only cancelled items as empty", () => {
    const stats = todoStats([item("1", "cancelled")])
    expect(stats.total).toBe(0)
    expect(stats.all).toBe(false)
  })
})

describe("todoVisible", () => {
  const open = todoStats([item("1", "completed"), item("2", "pending")])
  const done = todoStats([item("1", "completed"), item("2", "completed")])

  it("always shows a list with open items", () => {
    expect(todoVisible(open, "msg_1", "msg_9")).toBe(true)
  })

  it("keeps a finished list until a newer user message starts another run", () => {
    expect(todoVisible(done, "msg_5", "msg_3")).toBe(true)
    expect(todoVisible(done, "msg_5", "msg_7")).toBe(false)
  })

  it("hides an empty list", () => {
    expect(todoVisible(todoStats([]), undefined, undefined)).toBe(false)
  })
})

describe("todoFinished", () => {
  it("fires when the last open item of the same list finishes", () => {
    const prev = todoStats([item("1", "completed"), item("2", "in_progress")])
    const next = todoStats([item("1", "completed"), item("2", "completed")])
    expect(todoFinished(prev, next)).toBe(true)
  })

  it("does not fire for a list that arrives already done", () => {
    const next = todoStats([item("1", "completed")])
    expect(todoFinished(todoStats([]), next)).toBe(false)
    expect(todoFinished(next, next)).toBe(false)
  })

  it("does not fire when a done list replaces another list", () => {
    const prev = todoStats([item("1", "completed"), item("2", "pending")])
    const next = todoStats([item("a", "completed"), item("b", "completed")])
    expect(todoFinished(prev, next)).toBe(false)
  })

  it("does not fire when the replaced list only shares items that were already done", () => {
    const prev = todoStats([item("1", "completed"), item("2", "pending")])
    const next = todoStats([item("1", "completed"), item("b", "completed")])
    expect(todoFinished(prev, next)).toBe(false)
  })
})

describe("todoFit", () => {
  const base = { chip: 26, count: 28, gap: 2, goal: { full: 90, compact: 26 } }

  it("shows everything when there is room", () => {
    expect(todoFit({ ...base, space: 600, title: 140 })).toEqual({ title: 140, count: true, compact: false })
  })

  it("caps a long title", () => {
    expect(todoFit({ ...base, space: 900, title: 500 }).title).toBe(TODO_TITLE_MAX)
  })

  it("truncates the title before it hides the goal label", () => {
    const fit = todoFit({ ...base, space: 240, title: 200 })
    expect(fit.compact).toBe(false)
    expect(fit.title).toBe(240 - 26 - 28 - 92)
  })

  it("hides the goal label, then the title, then the count", () => {
    expect(todoFit({ ...base, space: 150, title: 200 })).toEqual({ title: 68, count: true, compact: true })
    expect(todoFit({ ...base, space: 100, title: 200 })).toEqual({ title: 0, count: true, compact: true })
    expect(todoFit({ ...base, space: 60, title: 200 })).toEqual({ title: 0, count: false, compact: true })
  })

  it("keeps the goal label when there is no title to show", () => {
    expect(todoFit({ ...base, space: 150, title: 0 })).toEqual({ title: 0, count: true, compact: false })
  })

  it("never compacts a goal that is not there", () => {
    expect(todoFit({ ...base, goal: undefined, space: 40, title: 200 })).toEqual({
      title: 0,
      count: false,
      compact: false,
    })
  })
})

describe("todoState", () => {
  const user = (id: string): SessionMessageInfo => ({ id, type: "user", text: id, time: { created: 1 } })
  const write = (id: string, todos: unknown, status = "completed") =>
    ({
      id,
      type: "assistant",
      time: { created: 1 },
      content: [
        {
          type: "tool",
          id: `${id}-part`,
          name: "todowrite",
          time: { created: 1 },
          state: status === "completed" ? { status, input: {}, content: [], metadata: { todos } } : { status, input: {} },
        },
      ],
    }) as unknown as SessionMessageInfo

  it("reads the latest completed todowrite call", () => {
    const state = todoState([
      user("msg_1"),
      write("msg_2", [item("1", "pending")]),
      write("msg_3", [item("1", "completed"), item("2", "in_progress")]),
    ])
    expect(state.items).toEqual([item("1", "completed"), item("2", "in_progress")])
    expect(state.last).toBe("msg_3")
    expect(state.user).toBe("msg_1")
  })

  it("ignores a write that has not completed", () => {
    const state = todoState([write("msg_1", [item("1", "pending")]), write("msg_2", [item("2", "pending")], "running")])
    expect(state.items).toEqual([item("1", "pending")])
    expect(state.last).toBe("msg_1")
  })

  it("clears the list with an empty write", () => {
    expect(todoState([write("msg_1", [item("1", "pending")]), write("msg_2", [])]).items).toEqual([])
  })

  it("ignores malformed items and keeps the last valid list", () => {
    const state = todoState([
      write("msg_1", [item("1", "pending")]),
      write("msg_2", [{ content: 1, status: "pending" }, { content: "ok", status: "unknown" }]),
    ])
    expect(state.items).toEqual([item("1", "pending")])
    expect(state.last).toBe("msg_1")
  })

  it("drops a reverted write and keeps the list before it", () => {
    const state = todoState([write("msg_1", [item("1", "pending")]), write("msg_2", [item("2", "pending")])], {
      messageID: "msg_2",
    })
    expect(state.items).toEqual([item("1", "pending")])
    expect(state.last).toBe("msg_1")
  })

  it("keeps only the parts before a reverted part", () => {
    const message = {
      id: "msg_1",
      type: "assistant",
      time: { created: 1 },
      content: [
        {
          type: "tool",
          id: "part-a",
          name: "todowrite",
          time: { created: 1 },
          state: { status: "completed", input: {}, content: [], metadata: { todos: [item("a", "pending")] } },
        },
        {
          type: "tool",
          id: "part-b",
          name: "todowrite",
          time: { created: 1 },
          state: { status: "completed", input: {}, content: [], metadata: { todos: [item("b", "pending")] } },
        },
      ],
    } as unknown as SessionMessageInfo
    expect(todoState([message], { messageID: "msg_1", partID: "part-b" }).items).toEqual([item("a", "pending")])
    expect(todoState([message], { messageID: "msg_1", partID: "part-b" }).last).toBe("msg_1")
    expect(todoState([message], { messageID: "msg_1" }).items).toEqual([])
    expect(todoState([message], { messageID: "msg_1" }).last).toBeUndefined()
  })

  it("uses the latest user message as the run boundary, not a synthetic one", () => {
    const synthetic = { id: "msg_3", type: "synthetic", text: "result", time: { created: 1 } } as SessionMessageInfo
    expect(todoState([user("msg_1"), synthetic, write("msg_2", [item("1", "pending")])]).user).toBe("msg_1")
  })

  it("ignores a reverted user message for the run boundary", () => {
    const state = todoState([user("msg_1"), write("msg_2", [item("1", "pending")]), user("msg_3")], {
      messageID: "msg_3",
    })
    expect(state.user).toBe("msg_1")
  })

  it("keeps a finished list hidden while a newer write has not completed", () => {
    const state = todoState([
      user("msg_3"),
      write("msg_2", [item("1", "completed"), item("2", "completed")]),
      write("msg_4", [item("1", "completed"), item("2", "completed"), item("3", "pending")], "running"),
    ])
    expect(state.last).toBe("msg_2")
    expect(todoVisible(todoStats(state.items), state.last, state.user)).toBe(false)
  })

  it("treats a reverted write as absent when deciding whether to page older history", () => {
    const messages = [write("msg_1", [item("1", "pending")])]
    expect(hasTodoWrite(messages)).toBe(true)
    expect(hasTodoWrite(messages, { messageID: "msg_1" })).toBe(false)
  })
})