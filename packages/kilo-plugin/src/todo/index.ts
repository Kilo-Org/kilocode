import { TodoTool } from "@opencode/core/tool/plugin/todo"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import DESCRIPTION from "./todowrite.txt"

/**
 * Kilo keeps the todo tool always available, as v1 did. The upstream tool is
 * registered only when `experimental.todo` is set, so this plugin removes that
 * tool and adds the Kilo one on every location. It runs after the internal todo
 * plugin, so the result is one tool with the Kilo description.
 */
export const KiloTodoPlugin = define({
  id: "kilocode.tool-todo",
  effect: Effect.fn("KiloTodoTool.Plugin")(function* (ctx) {
    yield* ctx.tool
      .transform((editor) => {
        editor.remove(TodoTool.name)
        editor.add({
          name: TodoTool.name,
          options: { codemode: false },
          description: DESCRIPTION,
          input: TodoTool.Input,
          output: TodoTool.Output,
          execute: (input, context) =>
            ctx.permission
              .assert({
                action: TodoTool.name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              .pipe(
                Effect.as({
                  output: { todos: input.todos },
                  content: TodoTool.summarize(input.todos),
                  metadata: { todos: input.todos },
                }),
              ),
        })
      })
      .pipe(Effect.orDie)
  }),
})
