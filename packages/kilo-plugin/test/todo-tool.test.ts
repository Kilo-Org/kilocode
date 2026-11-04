import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloTodoPlugin } from "../src/todo"

const todos = [
  { content: "Inspect files", status: "in_progress" },
  { content: "Implement fix", status: "pending" },
] as const

type Result = { metadata?: { todos?: unknown } }
type Added = {
  name: string
  description: string
  execute: (input: never, context: never) => Effect.Effect<Result, unknown>
}
type Editor = {
  remove: (id: string) => void
  add: (tool: Added) => void
}

describe("KiloTodoPlugin", () => {
  test("replaces the gated tool with the Kilo tool on every location", async () => {
    const removed: string[] = []
    const added: Added[] = []
    const editor: Editor = {
      remove: (id) => removed.push(id),
      add: (tool) => added.push(tool),
    }
    const ctx = {
      tool: { transform: (fn: (editor: Editor) => void) => Effect.sync(() => fn(editor)) },
      permission: { assert: () => Effect.void },
    }

    await Effect.runPromise(Effect.scoped(KiloTodoPlugin.effect(ctx as never)))

    expect(removed).toEqual(["todowrite"])
    expect(added).toHaveLength(1)
    expect(added[0]?.name).toBe("todowrite")
    expect(added[0]?.description).toContain("call this tool before starting the first item")
    expect(added[0]?.description).toContain("After completing each item, call this tool before starting the next item")
    expect(added[0]?.description).toContain("Do not complete multiple items or continue through multiple steps")

    const result = await Effect.runPromise(added[0]!.execute({ todos } as never, {} as never))
    expect(result.metadata?.todos).toEqual(todos)
  })
})
