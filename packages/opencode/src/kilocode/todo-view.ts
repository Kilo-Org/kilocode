export namespace TodoView {
  export type Todo = {
    content: string
    status: string
    priority: string
  }

  export type Item = Todo & {
    changed?: boolean
  }

  export type Info = {
    mode: "full" | "compact"
    todos: Item[]
    hiddenBefore: number
    hiddenAfter: number
    changed: number
  }

  export function calculate(before: Todo[], after: Todo[]): Info {
    const diff = after
      .map((todo, index) => ({
        index,
        changed: !same(before[index], todo),
      }))
      .filter((item) => item.changed)

    const wide =
      before.length === 0 ||
      after.length === 0 ||
      structural(before, after) ||
      terminal(after) ||
      diff.length === 0
    if (wide) return full(after, diff.length)

    const first = Math.max(0, Math.min(...diff.map((item) => item.index)) - 1)
    const last = Math.min(after.length - 1, Math.max(...diff.map((item) => item.index)) + 1)
    const hidden = first + after.length - last - 1
    if (hidden === 0) return full(after, diff.length)

    const set = new Set(diff.map((item) => item.index))
    return {
      mode: "compact",
      todos: after.slice(first, last + 1).map((todo, index) => ({
        ...todo,
        changed: set.has(first + index),
      })),
      hiddenBefore: first,
      hiddenAfter: after.length - last - 1,
      changed: diff.length,
    }
  }

  function full(todos: Todo[], changed: number): Info {
    return {
      mode: "full",
      todos,
      hiddenBefore: 0,
      hiddenAfter: 0,
      changed,
    }
  }

  function same(before: Todo | undefined, after: Todo) {
    if (!before) return false
    return before.content === after.content && before.status === after.status && before.priority === after.priority
  }

  function terminal(todos: Todo[]) {
    return todos.every((todo) => todo.status === "completed" || todo.status === "cancelled")
  }

  function structural(before: Todo[], after: Todo[]) {
    if (before.length !== after.length) return true
    return after.some((todo, index) => before[index]?.content !== todo.content)
  }
}
