import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import type { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { TodoTool } from "@opencode/core/tool/plugin/todo"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { testEffect } from "../lib/effect"
import { imagePassthrough } from "../lib/image"
import { permissionLayer } from "../lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "../lib/tool"

const sessionID = Session.ID.make("ses_todo_view_test")
const enabled = new ConfigExperimental.Info({ todo: true })

const it = testEffect(
  AppNodeBuilder.build(Tool.node, [Image.node.replace(imagePassthrough), Permission.node.replace(permissionLayer())]),
)

const before: Array<{ content: string; status: string }> = [
  { content: "One", status: "pending" },
  { content: "Two", status: "in_progress" },
  { content: "Three", status: "pending" },
  { content: "Four", status: "pending" },
]

const after = before.map((todo) => ({ ...todo }))
after[1] = { content: "Two", status: "completed" }

const previous = [
  {
    type: "assistant",
    content: [
      {
        type: "tool",
        id: "part-todo-1",
        name: "todowrite",
        time: { created: 1 },
        state: { status: "completed", input: { todos: before }, content: [], metadata: { todos: before } },
      },
    ],
  },
] as unknown as SessionMessage.Info[]

const setup = Effect.gen(function* () {
  yield* registerToolPlugin(
    TodoTool.Plugin,
    {
      event: { subscribe: () => Stream.never },
      session: { context: () => Effect.succeed(previous) },
    },
    undefined,
  ).pipe(
    Effect.provide(Layer.mock(Config.Service)({ entries: () => Effect.succeed([document(enabled)]) })),
    Effect.provide(permissionLayer({ assert: () => Effect.void })),
  )
  return yield* Tool.Service
})

describe("todo view tool output", () => {
  it.effect("emits a compact view from the previous list", () =>
    Effect.gen(function* () {
      const registry = yield* setup
      const execution = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-todo-view", name: TodoTool.name, input: { todos: after } },
      })
      expect(execution.status).toBe("completed")
      expect(execution.metadata).toMatchObject({
        todos: after,
        view: {
          mode: "compact",
          hiddenBefore: 0,
          hiddenAfter: 1,
          changed: 1,
          todos: [{ content: "One" }, { content: "Two", done: true, changed: true }, { content: "Three" }],
        },
      })
    }),
  )
})

function document(experimental: ConfigExperimental.Info | undefined): Entry {
  return new Document({ type: "document", info: new Info(experimental ? { experimental } : {}) })
}
