import { describe, expect, it } from "bun:test"
import {
  TODO_TITLE_MAX,
  todoFinished,
  todoFit,
  todoStats,
  todoVisible,
} from "../../webview-ui/src/components/chat/todo/todo-dock"
import type { TodoItem } from "../../webview-ui/src/types/messages"

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
