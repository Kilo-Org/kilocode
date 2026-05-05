import { describe, expect, test } from "bun:test"
import { TodoView } from "../../src/kilocode/todo-view"

function item(content: string, status = "pending"): TodoView.Todo {
  return { content, status, priority: "medium" }
}

describe("TodoView.calculate", () => {
  test("shows the full list when todos are first created", () => {
    const after = [item("Inspect files"), item("Implement fix"), item("Run checks")]
    const view = TodoView.calculate([], after)

    expect(view.mode).toBe("full")
    expect(view.todos).toEqual(after)
    expect(view.hiddenBefore).toBe(0)
    expect(view.hiddenAfter).toBe(0)
  })

  test("shows a compact window around the changed item", () => {
    const before = Array.from({ length: 10 }, (_, index) => item(`Task ${index + 1}`))
    const after = before.map((todo, index) => (index === 4 ? { ...todo, status: "completed" } : todo))
    const view = TodoView.calculate(before, after)

    expect(view.mode).toBe("compact")
    expect(view.hiddenBefore).toBe(3)
    expect(view.hiddenAfter).toBe(4)
    expect(view.todos.map((todo) => todo.content)).toEqual(["Task 4", "Task 5", "Task 6"])
    expect(view.todos.map((todo) => Boolean(todo.changed))).toEqual([false, true, false])
  })

  test("shows the full list when all todos are terminal", () => {
    const before = [item("Inspect files", "completed"), item("Implement fix"), item("Run checks")]
    const after = before.map((todo) => ({ ...todo, status: "completed" }))
    const view = TodoView.calculate(before, after)

    expect(view.mode).toBe("full")
    expect(view.todos).toEqual(after)
  })

  test("shows the full list when todo content is rewritten", () => {
    const before = [item("One"), item("Two"), item("Three"), item("Four")]
    const after = [item("One"), item("Two changed"), item("Three"), item("Four")]
    const view = TodoView.calculate(before, after)

    expect(view.mode).toBe("full")
    expect(view.todos).toEqual(after)
  })

  test("shows the full list when todos are added", () => {
    const before = [item("One"), item("Two"), item("Three")]
    const after = [...before, item("Four")]
    const view = TodoView.calculate(before, after)

    expect(view.mode).toBe("full")
    expect(view.todos).toEqual(after)
  })
})
