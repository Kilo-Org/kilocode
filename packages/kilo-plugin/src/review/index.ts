export * as KiloReview from "./index"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import PROMPT from "./review.txt"

export const name = "review"
export const description = "review changes [uncommitted|staged|unpushed|branch|commit|pr]"

/** The prompt of one `/review` invocation: the text typed after the command replaces `$ARGUMENTS`. */
export function template(input: string) {
  return PROMPT.replaceAll("$ARGUMENTS", () => input.trim())
}

// The command registry keeps the last definition of a name. This plugin runs after the built-in plugins and before the
// config plugins, so it replaces the built-in `review`, and a config-defined `review` still replaces it.
export const Plugin = define({
  id: "kilocode.review",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.command.transform((editor) =>
      editor.add({
        name,
        description,
        execute: (input) =>
          ctx.session
            .prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: template(input.prompt.text),
              delivery: input.delivery,
            })
            .pipe(Effect.asVoid),
      }),
    )
  }),
})
