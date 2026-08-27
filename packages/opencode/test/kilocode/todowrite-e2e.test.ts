import { describe, expect } from "bun:test"
import { createKiloClient } from "@kilocode/sdk/v2"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

const todos = [
  [
    { content: "Inspect files", status: "in_progress", priority: "high" },
    { content: "Implement fix", status: "pending", priority: "medium" },
    { content: "Run checks", status: "pending", priority: "medium" },
    { content: "Report results", status: "pending", priority: "low" },
  ],
  [
    { content: "Inspect files", status: "completed", priority: "high" },
    { content: "Implement fix", status: "in_progress", priority: "medium" },
    { content: "Run checks", status: "pending", priority: "medium" },
    { content: "Report results", status: "pending", priority: "low" },
  ],
  [
    { content: "Inspect files", status: "completed", priority: "high" },
    { content: "Implement fix", status: "completed", priority: "medium" },
    { content: "Run checks", status: "in_progress", priority: "medium" },
    { content: "Report results", status: "pending", priority: "low" },
  ],
  [
    { content: "Inspect files", status: "completed", priority: "high" },
    { content: "Implement fix", status: "completed", priority: "medium" },
    { content: "Run checks", status: "completed", priority: "medium" },
    { content: "Report results", status: "in_progress", priority: "low" },
  ],
  [
    { content: "Inspect files", status: "completed", priority: "high" },
    { content: "Implement fix", status: "completed", priority: "medium" },
    { content: "Run checks", status: "completed", priority: "medium" },
    { content: "Report results", status: "completed", priority: "low" },
  ],
] as const

describe("todowrite end-to-end", () => {
  cliIt.live(
    "persists every sequential update through the real CLI session",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        const client = createKiloClient({ baseUrl: server.url })
        const session = yield* Effect.promise(() =>
          client.session.create({
            permission: [{ permission: "*", action: "allow", pattern: "*" }],
          }),
        )
        const sessionID = session.data?.id
        if (!sessionID) throw new Error("test session was not created")

        for (const list of todos) yield* llm.tool("todowrite", { todos: list })
        yield* llm.text("done")

        const result = yield* opencode.run("complete this four-step task", {
          extraArgs: ["--attach", server.url, "--session", sessionID, "--auto"],
          timeoutMs: 90_000,
        })
        opencode.expectExit(result, 0)

        expect(JSON.stringify(yield* llm.inputs)).toContain(
          "After completing each item, call this tool before starting the next item",
        )
        const saved = yield* Effect.promise(() => client.session.todo({ sessionID }))
        const final = todos[todos.length - 1]?.map((todo) => ({ ...todo }))
        expect(saved.data).toEqual(final)

        const messages = yield* Effect.promise(() => client.session.messages({ sessionID }))
        const calls =
          messages.data?.flatMap((message) =>
            message.parts.filter((part) => part.type === "tool" && part.tool === "todowrite"),
          ) ?? []
        expect(calls).toHaveLength(todos.length)
      }),
    120_000,
  )
})
