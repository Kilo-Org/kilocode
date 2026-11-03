import { describe, expect, test } from "bun:test"
import { TodoView } from "@opencode/core/kilocode/todo-view"

const todo = (content: string, status = "pending") => ({ content, status })

const list = (count: number) => Array.from({ length: count }, (_, index) => todo(`Task ${index + 1}`))

describe("todo view", () => {
  test("uses the full list for the first update", () => {
    const after = [todo("One", "in_progress"), todo("Two")]
    expect(TodoView.calculate([], after)).toEqual({
      mode: "full",
      todos: after,
      hiddenBefore: 0,
      hiddenAfter: 0,
      changed: 2,
    })
  })

  test("keeps one row of context around a change", () => {
    const before = list(6)
    const after = before.map((item) => ({ ...item }))
    after[2] = todo("Task 3", "in_progress")
    expect(TodoView.calculate(before, after)).toEqual({
      mode: "compact",
      todos: [
        { content: "Task 2", status: "pending", changed: false },
        { content: "Task 3", status: "in_progress", changed: true, started: true },
        { content: "Task 4", status: "pending", changed: false },
      ],
      hiddenBefore: 1,
      hiddenAfter: 2,
      changed: 1,
    })
  })

  test("marks a completed row as done", () => {
    const before = list(6)
    const after = before.map((item) => ({ ...item }))
    after[2] = todo("Task 3", "completed")
    const view = TodoView.calculate(before, after)
    expect(view.mode).toBe("compact")
    expect(view.todos[1]).toMatchObject({ content: "Task 3", status: "completed", done: true, changed: true })
  })

  test("uses the full list when the structure changes", () => {
    const before = list(4)
    const after = [todo("Task 1"), todo("Task 2"), todo("New"), todo("Task 4")]
    expect(TodoView.calculate(before, after).mode).toBe("full")
  })

  test("uses the full list when every row is terminal", () => {
    const before = list(4)
    const after = before.map((item) => todo(item.content, "completed"))
    expect(TodoView.calculate(before, after).mode).toBe("full")
  })

  test("uses the full list when nothing changed", () => {
    const before = list(4).map((item) => todo(item.content, "completed"))
    expect(TodoView.calculate(before, before).mode).toBe("full")
  })
})
